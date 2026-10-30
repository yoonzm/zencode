#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::Value;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use zencode_core::{runtime::Runtime, text};
mod updater;
#[tauri::command]
async fn desktop_call(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Runtime>>,
    op: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let args = args.unwrap_or(Value::Null);
    if matches!(op.as_str(), "updateInfo" | "checkUpdate" | "downloadUpdate" | "installUpdate") {
        return updater::call(&app, state.inner(), &op, args).await;
    }
    match op.as_str() {
        "openWorkdir" => {
            let target = state.inner().call("workdirTarget", args.clone()).await?;
            let path = target.as_str().ok_or("工作目录不存在")?;
            if args["editor"].as_bool() == Some(true) {
                let normalized = path.replace('\\', "/");
                let mut url = url::Url::parse("vscode://file/").map_err(|e| e.to_string())?;
                let line = args["line"].as_u64().filter(|n| *n > 0);
                url.set_path(&format!("/{}{}", normalized.trim_start_matches('/'), line.map(|n| format!(":{n}")).unwrap_or_default()));
                app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string())?;
            } else {
                app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())?;
            }
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
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::UpdaterState::default())
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
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(|url| {
                    url.scheme() == "tauri"
                        || (["http", "https"].contains(&url.scheme())
                            && url.host_str() == Some("tauri.localhost"))
                })
                .build()?;
            let open = MenuItem::with_id(app, "tray-open", "打开 ZenCode", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().ok_or("缺少托盘图标")?.clone())
                .tooltip("ZenCode · 后台运行")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray-open" => show_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
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
