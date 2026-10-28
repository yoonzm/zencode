#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::Value;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use zencode_core::{runtime::Runtime, text};
#[tauri::command]
async fn desktop_call(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Runtime>>,
    op: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let args = args.unwrap_or(Value::Null);
    match op.as_str() {
        "window" => {
            let w = app.get_webview_window("main").ok_or("窗口不存在")?;
            match text(&args, "action") {
                "关闭" => w.close(),
                "最小化" => w.minimize(),
                _ => {
                    if w.is_maximized().map_err(|e| e.to_string())? {
                        w.unmaximize()
                    } else {
                        w.maximize()
                    }
                }
            }
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "attachment" => {
            let path = state.inner().call(&op, args).await?;
            app.opener()
                .reveal_item_in_dir(path.as_str().ok_or("无效下载路径")?)
                .map_err(|e| e.to_string())?;
            Ok(path)
        }
        "open" => {
            let raw = text(&args, "url");
            let u = url::Url::parse(raw).map_err(|e| e.to_string())?;
            if !["http", "https"].contains(&u.scheme())
                || !u.username().is_empty()
                || u.password().is_some()
            {
                return Err("不允许打开此链接".into());
            }
            app.opener()
                .open_url(raw, None::<&str>)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        _ => state.inner().call(&op, args).await,
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            std::fs::create_dir_all(&root)?;
            let handle = app.handle().clone();
            let rt = Runtime::new(
                root,
                Arc::new(move |event, payload| {
                    let _ = handle.emit(event, &payload);
                    if event == "desktop:notification"
                        && !handle
                            .get_webview_window("main")
                            .and_then(|w| w.is_focused().ok())
                            .unwrap_or(false)
                    {
                        let label = match text(&payload, "state") {
                            "review" => "等待审核",
                            "waiting" => "等待审批",
                            _ => "执行失败",
                        };
                        let mut notice = handle
                            .notification()
                            .builder()
                            .title("ZenCode")
                            .body(format!("{} · {}", text(&payload, "title"), label));
                        if payload["sound"].as_bool() == Some(true) {
                            notice = notice.sound("default");
                        }
                        let _ = notice.show();
                    }
                }),
            )
            .map_err(std::io::Error::other)?;
            app.manage(rt);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![desktop_call])
        .build(tauri::generate_context!())
        .expect("无法启动 ZenCode")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let rt = app.state::<Arc<Runtime>>().inner().clone();
                tauri::async_runtime::block_on(rt.shutdown());
            }
        });
}
