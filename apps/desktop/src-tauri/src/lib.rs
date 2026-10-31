use std::sync::Mutex;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, RunEvent, WebviewWindow, WindowEvent, Wry};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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
        .invoke_handler(tauri::generate_handler![take_deep_links, hide_capture])
        .menu(build_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quick-capture" => toggle_capture(app),
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
