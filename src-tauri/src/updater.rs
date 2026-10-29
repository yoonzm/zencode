use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;
use zencode_core::{runtime::Runtime, text, update_feed::{select_manifest, REPOSITORY}, Result};

#[derive(Default)]
pub struct Pending {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}
pub type UpdaterState = Mutex<Pending>;

pub async fn call(app: &tauri::AppHandle, runtime: &Arc<Runtime>, op: &str, args: Value) -> Result<Value> {
    if op == "updateInfo" { return Ok(json!({"version":app.package_info().version.to_string()})); }
    let state = app.state::<UpdaterState>();
    // All callers share one operation lock, including install and channel changes.
    let mut pending = state.try_lock().map_err(|_| "更新操作正在进行，请稍后再试")?;
    match op {
        "checkUpdate" => {
            let public_key = option_env!("ZENCODE_UPDATER_PUBLIC_KEY").unwrap_or("").trim();
            if public_key.is_empty() { return Err("此构建未配置更新签名公钥，请使用已配置自动更新的正式安装包".into()); }
            pending.update = None;
            pending.bytes = None;
            let client = reqwest::Client::builder().user_agent("ZenCode-Updater").timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
            let mut releases = Vec::new();
            for page in 1..=10 {
                let batch: Vec<Value> = client.get(format!("https://api.github.com/repos/{REPOSITORY}/releases?per_page=100&page={page}"))
                    .send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| format!("无法读取公开发布列表：{e}"))?
                    .json().await.map_err(|e| e.to_string())?;
                let done = batch.len() < 100;
                releases.extend(batch);
                if done { break; }
                if page == 10 { return Err("发布列表过长，未完成更新检查".into()); }
            }
            let Some(endpoint) = select_manifest(&releases, text(&args,"channel"), &app.package_info().version.to_string())? else {
                return Ok(json!({"status":"latest"}));
            };
            let update = app.updater_builder().pubkey(public_key)
                .endpoints(vec![url::Url::parse(&endpoint).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?
                .timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())?
                .check().await.map_err(|e| e.to_string())?;
            match update {
                Some(mut update) => {
                    if update.download_url.scheme() != "https" { return Err("更新包必须使用 HTTPS".into()); }
                    let version = semver::Version::parse(&update.version).map_err(|e| e.to_string())?;
                    if !endpoint.contains(&format!("/v{version}/")) || (text(&args,"channel") == "stable" && !version.pre.is_empty()) {
                        return Err("更新清单版本与发布版本或通道不一致".into());
                    }
                    let result = json!({"status":"available","version":update.version,"notes":update.body});
                    // Artifact downloads need a longer budget than metadata requests.
                    update.timeout = Some(std::time::Duration::from_secs(15 * 60));
                    pending.update = Some(update);
                    Ok(result)
                }
                None => Ok(json!({"status":"latest"})),
            }
        }
        "downloadUpdate" => {
            let update = pending.update.as_ref().ok_or("请先检查更新")?;
            let mut received = 0u64;
            let bytes = update.download(|chunk, total| {
                received += chunk as u64;
                let progress = total.filter(|n| *n > 0).map(|n| (received.saturating_mul(100) / n).min(99));
                let _ = app.emit("desktop:update", json!({"progress":progress,"received":received,"total":total}));
            }, || {}).await.map_err(|e| e.to_string())?;
            pending.bytes = Some(bytes);
            Ok(json!({"status":"ready","progress":100}))
        }
        "installUpdate" => {
            let update = pending.update.as_ref().ok_or("请先检查更新")?;
            let bytes = pending.bytes.as_ref().ok_or("请先下载更新")?;
            runtime.prepare_update(&update.version).await?;
            // Windows installation can exit this process, so checkpoint before install.
            if let Err(error) = update.install(bytes) {
                runtime.cancel_update().await?;
                return Err(format!("安装失败，任务已保留，可手动继续：{error}"));
            }
            app.restart();
        }
        _ => Err("不支持的更新操作".into()),
    }
}
