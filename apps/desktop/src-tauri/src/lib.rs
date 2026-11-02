use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, RunEvent, WebviewWindow, WindowEvent, Wry};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

const MAIN: &str = "main";
const CAPTURE: &str = "capture";

/// Deep links wait here until the SPA takes them. Links can arrive before the webview has
/// loaded (cold start from `mado://MAD-109`), so the SPA pulls instead of relying on the event.
#[derive(Default)]
struct PendingLinks(Mutex<Vec<String>>);

#[tauri::command]
fn take_deep_links(state: tauri::State<PendingLinks>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Updates download and install in the background; the SPA then offers a restart. The version
/// waits here too, because the install can finish before the SPA is listening (or signed in).
#[derive(Default)]
struct Updates {
    ready: Mutex<Option<String>>,
    busy: AtomicBool,
}

const UPDATE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[tauri::command]
fn update_ready(state: tauri::State<Updates>) -> Option<String> {
    state.ready.lock().unwrap().clone()
}

#[tauri::command]
fn check_updates(app: AppHandle) {
    tauri::async_runtime::spawn(check_for_update(app, true));
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

/// `manual` reports every outcome to the SPA; the scheduled check only speaks up once an update is ready.
async fn check_for_update(app: AppHandle, manual: bool) {
    let state = app.state::<Updates>();
    if let Some(version) = state.ready.lock().unwrap().clone() {
        let _ = app.emit_to(MAIN, "update:ready", version);
        return;
    }
    if state.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = async {
        let Some(update) = app.updater()?.check().await? else { return Ok(None) };
        if manual {
            let _ = app.emit_to(MAIN, "update:downloading", update.version.clone());
        }
        update.download_and_install(|_, _| {}, || {}).await?;
        Ok::<_, tauri_plugin_updater::Error>(Some(update.version))
    }
    .await;
    state.busy.store(false, Ordering::SeqCst);
    match result {
        Ok(Some(version)) => {
            *state.ready.lock().unwrap() = Some(version.clone());
            let _ = app.emit_to(MAIN, "update:ready", version);
        }
        Ok(None) if manual => {
            let _ = app.emit_to(MAIN, "update:none", ());
        }
        Ok(None) => {}
        Err(e) => {
            eprintln!("update check failed: {e}");
            if manual {
                let _ = app.emit_to(MAIN, "update:error", e.to_string());
            }
        }
    }
}

#[tauri::command]
fn hide_capture(app: AppHandle) {
    if let Some(w) = app.get_webview_window(CAPTURE) {
        let _ = w.hide();
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Centered horizontally, in the upper third of the screen the cursor is on.
fn place_capture(app: &AppHandle, w: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten());
    let (Some(m), Ok(size)) = (monitor, w.outer_size()) else { return };
    let area = m.work_area();
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + area.size.height as i32 / 5;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

fn toggle_capture(app: &AppHandle) {
    let Some(w) = app.get_webview_window(CAPTURE) else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    place_capture(app, &w);
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit("capture:open", ());
}

fn receive_links(app: &AppHandle, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }
    app.state::<PendingLinks>().0.lock().unwrap().extend(urls);
    show_main(app);
    let _ = app.emit_to(MAIN, "deep-link", ());
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let sep = || PredefinedMenuItem::separator(app);
    let item = |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);

    let app_menu = Submenu::with_items(
        app,
        "mado",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About mado"), Some(AboutMetadata::default()))?,
            &item("check-updates", "Check for Updates…", None)?,
            &sep()?,
            &item("settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &item("change-server", "Change server…", None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("new-task", "New task", Some("CmdOrCtrl+N"))?,
            &item("quick-capture", "Quick capture", Some("Alt+Space"))?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("toggle-sidebar", "Toggle sidebar", Some("CmdOrCtrl+\\"))?,
            &item("command-palette", "Command palette", Some("CmdOrCtrl+K"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
        ],
    )?;
    let help = Submenu::with_items(app, "Help", true, &[&item("shortcuts", "Keyboard shortcuts", Some("CmdOrCtrl+/"))?])?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let capture_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);

    let app = tauri::Builder::default()
        .manage(PendingLinks::default())
        .manage(Updates::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &capture_shortcut && event.state() == ShortcutState::Pressed {
                        toggle_capture(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![take_deep_links, hide_capture, update_ready, check_updates, restart_app])
        .menu(build_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quick-capture" => toggle_capture(app),
            "check-updates" => {
                show_main(app);
                check_updates(app.clone());
            }
            id => {
                show_main(app);
                let _ = app.emit_to(MAIN, "menu", id);
            }
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing the main window keeps the app (and ⌥Space) alive, like other Mac apps.
            (MAIN, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            (CAPTURE, WindowEvent::Focused(false)) => {
                let _ = window.hide();
            }
            _ => {}
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                receive_links(&handle, urls.iter().map(|u| u.to_string()).collect());
            }
            let on_open = handle.clone();
            app.deep_link().on_open_url(move |event| {
                receive_links(&on_open, event.urls().iter().map(|u| u.to_string()).collect());
            });
            if let Err(e) = app.global_shortcut().register(capture_shortcut) {
                eprintln!("could not register ⌥Space: {e}");
            }
            // Dev builds have no release to compare against.
            if !cfg!(debug_assertions) {
                let updates = handle.clone();
                tauri::async_runtime::spawn(async move {
                    // Let the window load first; the check needs no attention from the user.
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    loop {
                        check_for_update(updates.clone(), false).await;
                        tokio::time::sleep(UPDATE_INTERVAL).await;
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building mado");

    app.run(|_app, _event| {
        // Clicking the Dock icon with every window hidden brings the main window back.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { has_visible_windows: false, .. } = _event {
            show_main(_app);
        }
    });
}
