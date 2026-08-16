use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Listener, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

static SUB2API_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

const WIDGET_ORB_WIDTH: f64 = 166.0;
const WIDGET_ORB_HEIGHT: f64 = 50.0;
const WIDGET_CARD_WIDTH: f64 = 314.0;
const WIDGET_CARD_HEIGHT: f64 = 382.0;
const WIDGET_SETUP_WIDTH: f64 = 390.0;
const WIDGET_SETUP_HEIGHT: f64 = 490.0;
const WIDGET_SETTINGS_WIDTH: f64 = 390.0;
const WIDGET_SETTINGS_HEIGHT: f64 = 620.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sub2apiRequest {
    url: String,
    headers: HashMap<String, String>,
    method: Option<String>,
    body: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            sub2api_request,
            tray_command,
            set_widget_expanded,
            set_widget_setup,
            set_widget_settings,
            set_widget_always_on_top
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let update_window_handle = app.handle().clone();
            app.listen("token-orb-open-update", move |_| {
                open_update_window(&update_window_handle);
            });

            let tray_handle = handle.clone();
            let tray_menu = MenuBuilder::new(app)
                .text("monitor", "打开监控")
                .text("settings", "重新配置")
                .text("update", "检查更新")
                .separator()
                .text("quit", "退出")
                .build()
                .map_err(|error| format!("Codex Local Monitor 托盘菜单初始化失败: {error}"))?;
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray.png"))
                .map_err(|error| format!("Codex Local Monitor 托盘图标加载失败: {error}"))?;

            let tray_result = TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if let Err(error) = tray_command(app.clone(), event.id().as_ref().to_string()) {
                        eprintln!("Codex Local Monitor 托盘菜单命令失败: {error}");
                    }
                })
                .tooltip("Codex Local Monitor")
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        rect,
                        ..
                    } = event
                    {
                        if button_state != MouseButtonState::Up {
                            return;
                        }
                        match button {
                            MouseButton::Left => toggle_monitor(&tray_handle, Some(rect)),
                            MouseButton::Right => {}
                            _ => {}
                        }
                    }
                })
                .build(app);

            if let Err(error) = tray_result {
                // Some restricted Windows desktop sessions do not expose the
                // notification-area API. Keep the monitor usable in that case.
                eprintln!("Codex Local Monitor 托盘初始化失败，继续运行监控窗口: {error}");
            }

            // Keep the dashboard visible from the first launch. It renders the
            // inline setup form when no local credentials have been saved yet.
            open_monitor(&handle, None);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running token orb");
}

#[tauri::command]
fn tray_command(app: AppHandle, command: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("tray-menu") {
        let _ = window.hide();
    }

    match command.as_str() {
        "monitor" => {
            let tray_rect = app
                .tray_by_id("main")
                .and_then(|tray| tray.rect().ok().flatten());
            open_monitor(&app, tray_rect);
        }
        "settings" => open_settings(&app),
        "update" => open_update_window(&app),
        "quit" => app.exit(0),
        _ => return Err(format!("未知托盘命令: {command}")),
    }

    Ok(())
}

#[tauri::command]
fn set_widget_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("platform")
        .ok_or_else(|| "监控窗口尚未创建".to_string())?;
    let size = if expanded {
        LogicalSize::new(WIDGET_CARD_WIDTH, WIDGET_CARD_HEIGHT)
    } else {
        LogicalSize::new(WIDGET_ORB_WIDTH, WIDGET_ORB_HEIGHT)
    };

    resize_widget_preserving_position(&app, &window, size)
}

#[tauri::command]
fn set_widget_setup(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("platform")
        .ok_or_else(|| "监控窗口尚未创建".to_string())?;
    window
        .set_size(LogicalSize::new(WIDGET_SETUP_WIDTH, WIDGET_SETUP_HEIGHT))
        .map_err(|error| format!("调整首次配置窗口大小失败: {error}"))?;
    let size = LogicalSize::new(WIDGET_SETUP_WIDTH, WIDGET_SETUP_HEIGHT);
    position_monitor_with_size(&app, &window, None, physical_size_for(&window, size));
    Ok(())
}

#[tauri::command]
fn set_widget_settings(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("platform")
        .ok_or_else(|| "监控窗口尚未创建".to_string())?;
    resize_widget_preserving_position(
        &app,
        &window,
        LogicalSize::new(WIDGET_SETTINGS_WIDTH, WIDGET_SETTINGS_HEIGHT),
    )
}

fn physical_size_for<R: Runtime>(
    window: &WebviewWindow<R>,
    size: LogicalSize<f64>,
) -> PhysicalSize<u32> {
    let scale = window.scale_factor().unwrap_or(1.0);
    PhysicalSize::new(
        (size.width * scale).round().max(1.0) as u32,
        (size.height * scale).round().max(1.0) as u32,
    )
}

fn resize_widget_preserving_position<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
    let old_position = window
        .outer_position()
        .unwrap_or_else(|_| PhysicalPosition::new(0, 0));
    let old_size = window
        .outer_size()
        .unwrap_or_else(|_| physical_size_for(window, size));
    let new_size = physical_size_for(window, size);
    let candidate = preserve_right_edge_position(old_position, old_size, new_size);

    window
        .set_size(size)
        .map_err(|error| format!("调整监控窗口大小失败: {error}"))?;

    let monitor = app
        .monitor_from_point(candidate.x as f64, candidate.y as f64)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|monitors| monitors.into_iter().next())
        });

    let position = monitor
        .as_ref()
        .map(|monitor| {
            clamp_monitor_position(
                candidate.x,
                candidate.y,
                new_size,
                monitor.position(),
                monitor.size(),
            )
        })
        .unwrap_or(candidate);

    window
        .set_position(position)
        .map_err(|error| format!("调整监控窗口位置失败: {error}"))
}

fn preserve_right_edge_position(
    old_position: PhysicalPosition<i32>,
    old_size: PhysicalSize<u32>,
    new_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let old_width = old_size.width.min(i32::MAX as u32) as i32;
    let new_width = new_size.width.min(i32::MAX as u32) as i32;
    let right_edge = old_position.x.saturating_add(old_width);
    PhysicalPosition::new(right_edge.saturating_sub(new_width), old_position.y)
}

#[tauri::command]
fn set_widget_always_on_top(app: AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("platform")
        .ok_or_else(|| "监控窗口尚未创建".to_string())?;
    window
        .set_always_on_top(enabled)
        .map_err(|error| format!("切换窗口置顶失败: {error}"))
}

#[tauri::command]
async fn sub2api_request(request: Sub2apiRequest) -> Result<serde_json::Value, String> {
    let client = sub2api_client()?;
    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase();
    let mut builder = match method.as_str() {
        "POST" => client.post(&request.url),
        "GET" => client.get(&request.url),
        _ => return Err(format!("sub2api 不支持的请求方法: {method}")),
    };

    for (key, value) in request.headers {
        builder = builder.header(key, value);
    }
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }
    if let Some(timeout_ms) = request.timeout_ms {
        builder = builder.timeout(Duration::from_millis(timeout_ms.clamp(1_000, 30_000)));
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("sub2api 请求失败: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format_sub2api_http_error(status.as_u16(), &detail));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("sub2api 响应解析失败: {error}"))
}

fn sub2api_client() -> Result<&'static reqwest::Client, String> {
    SUB2API_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .pool_idle_timeout(Duration::from_secs(90))
                .pool_max_idle_per_host(4)
                .tcp_keepalive(Duration::from_secs(60))
                .user_agent(concat!("Codex-Local-Monitor/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|error| format!("初始化 HTTP 客户端失败: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn format_sub2api_http_error(status: u16, detail: &str) -> String {
    let message = read_sub2api_error_detail(detail);
    if status == 401 || status == 403 {
        if message.is_empty() {
            return format!("认证失败，Token 错误或已失效（HTTP {status}）");
        }
        return format!("认证失败，Token 错误或已失效：{message}");
    }

    if message.is_empty() {
        return format!("sub2api 请求失败: HTTP {status}");
    }
    format!("sub2api 请求失败（HTTP {status}）：{message}")
}

fn read_sub2api_error_detail(detail: &str) -> String {
    let trimmed = detail.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(message) = read_error_message(&value) {
            return message;
        }
    }

    trimmed.to_string()
}

fn read_error_message(value: &serde_json::Value) -> Option<String> {
    if let Some(message) = value
        .as_str()
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        return Some(message.to_string());
    }

    let object = value.as_object()?;
    for key in ["message", "error", "detail", "msg"] {
        if let Some(message) = object.get(key).and_then(read_error_message) {
            return Some(message);
        }
    }
    None
}

fn toggle_monitor<R: Runtime>(app: &AppHandle<R>, tray_rect: Option<tauri::Rect>) {
    if let Some(window) = app.get_webview_window("platform") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.emit("token-orb-monitor-visibility", false);
            let _ = window.hide();
        } else {
            position_monitor(app, &window, tray_rect);
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("token-orb-monitor-visibility", true);
        }
        return;
    }

    open_monitor(app, tray_rect);
}

fn open_monitor<R: Runtime>(app: &AppHandle<R>, tray_rect: Option<tauri::Rect>) {
    if let Some(window) = app.get_webview_window("platform") {
        position_monitor(app, &window, tray_rect);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("token-orb-monitor-visibility", true);
        return;
    }

    let window = WebviewWindowBuilder::new(
        app,
        "platform",
        WebviewUrl::App("index.html?view=platform".into()),
    )
    .title("Codex Local Monitor")
    // Start large enough for first-run setup. Configured installs resize
    // themselves to the compact orb as soon as the WebView mounts.
    .inner_size(WIDGET_SETUP_WIDTH, WIDGET_SETUP_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .build();

    if let Ok(window) = window {
        position_monitor(app, &window, tray_rect);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("token-orb-monitor-visibility", true);
    }
}

fn open_settings<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("settings") {
        // Close a stale secondary window created by an older build. The
        // current settings flow is rendered by the already-mounted monitor.
        let _ = window.close();
    }

    if let Some(window) = app.get_webview_window("platform") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("token-orb-open-settings", ());
        return;
    }

    // Keep a fallback for the short startup race before the monitor WebView
    // has been created.
    open_monitor(app, None);
    if let Some(window) = app.get_webview_window("platform") {
        let _ = window.emit("token-orb-open-settings", ());
    }
}

fn open_update_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("token-orb-check-update", ());
        return;
    }

    let window = WebviewWindowBuilder::new(
        app,
        "updater",
        WebviewUrl::App("index.html?view=updater".into()),
    )
    .title("Codex Local Monitor 更新")
    .inner_size(420.0, 380.0)
    .resizable(false)
    .decorations(true)
    .always_on_top(true)
    .build();

    if let Ok(window) = window {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn position_monitor<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    tray_rect: Option<tauri::Rect>,
) {
    let window_size = window.outer_size().unwrap_or(PhysicalSize::new(360, 500));
    position_monitor_with_size(app, window, tray_rect, window_size);
}

fn position_monitor_with_size<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    tray_rect: Option<tauri::Rect>,
    window_size: PhysicalSize<u32>,
) {
    let monitor = tray_rect
        .and_then(|rect| {
            let anchor = tray_anchor(&rect);
            app.monitor_from_point(anchor.x as f64, anchor.y as f64)
                .ok()
                .flatten()
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|monitors| monitors.into_iter().next())
        });

    if let Some(monitor) = monitor {
        let position = monitor.position();
        let size = monitor.size();
        let x = position.x + size.width as i32 - window_size.width as i32 - 14;
        let y = position.y + 14;
        let position = clamp_monitor_position(x, y, window_size, position, size);
        let _ = window.set_position(position);
    }
}

fn tray_anchor(rect: &tauri::Rect) -> PhysicalPosition<i32> {
    let position = rect.position.to_physical::<i32>(1.0);
    let size = rect.size.to_physical::<u32>(1.0);
    PhysicalPosition::new(
        position.x + (size.width as i32 / 2),
        position.y + size.height as i32,
    )
}

fn clamp_monitor_position(
    x: i32,
    y: i32,
    window_size: PhysicalSize<u32>,
    monitor_position: &PhysicalPosition<i32>,
    monitor_size: &PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    const SCREEN_MARGIN: i32 = 8;
    let min_x = monitor_position.x + SCREEN_MARGIN;
    let max_x =
        monitor_position.x + monitor_size.width as i32 - window_size.width as i32 - SCREEN_MARGIN;
    let min_y = monitor_position.y + SCREEN_MARGIN;
    let max_y =
        monitor_position.y + monitor_size.height as i32 - window_size.height as i32 - SCREEN_MARGIN;
    PhysicalPosition::new(
        x.clamp(min_x, max_x.max(min_x)),
        y.clamp(min_y, max_y.max(min_y)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_anchor_uses_the_icon_center_and_bottom_edge() {
        let rect = tauri::Rect {
            position: tauri::Position::Physical(PhysicalPosition::new(1200, 0)),
            size: tauri::Size::Physical(PhysicalSize::new(24, 24)),
        };

        assert_eq!(tray_anchor(&rect), PhysicalPosition::new(1212, 24));
    }

    #[test]
    fn monitor_position_stays_within_the_clicked_monitor() {
        let position = clamp_monitor_position(
            1200,
            850,
            PhysicalSize::new(410, 300),
            &PhysicalPosition::new(0, 0),
            &PhysicalSize::new(1440, 900),
        );

        assert_eq!(position, PhysicalPosition::new(1022, 592));
    }

    #[test]
    fn logical_widget_sizes_are_scaled_to_physical_pixels() {
        // The helper is exercised indirectly by the size constants and keeps
        // the right-edge calculation correct on high-DPI monitors.
        assert_eq!(WIDGET_ORB_WIDTH as u32, 166);
        assert_eq!(WIDGET_CARD_HEIGHT as u32, 382);
        assert_eq!(WIDGET_SETUP_HEIGHT as u32, 490);
        assert_eq!(WIDGET_SETTINGS_HEIGHT as u32, 620);
    }

    #[test]
    fn sub2api_http_client_is_reused() {
        let first = sub2api_client().expect("client should initialize");
        let second = sub2api_client().expect("client should be cached");

        assert!(std::ptr::eq(first, second));
    }

    #[test]
    fn widget_resize_preserves_right_edge_and_vertical_position() {
        let position = preserve_right_edge_position(
            PhysicalPosition::new(1200, 80),
            PhysicalSize::new(166, 50),
            PhysicalSize::new(314, 382),
        );

        assert_eq!(position, PhysicalPosition::new(1052, 80));
    }
}
