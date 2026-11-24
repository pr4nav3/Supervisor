//! Windows' Text size (Settings > Accessibility). WebView2 folds it into the page's scale, so at
//! 120% a 920 px window holds a 767 px page and the layout is squeezed. Like Chrome, the windows
//! grow by the same factor instead, and the page keeps the layout it was made for. A Mac's web
//! view has no such setting, so the factor there is 1.

use tauri::{AppHandle, LogicalSize, Manager};

/// What Windows multiplies text by (1 to 2.25); 1 where there is no such setting.
pub fn factor() -> f64 {
    #[cfg(windows)]
    {
        use windows::UI::ViewManagement::UISettings;
        if let Ok(factor) = UISettings::new().and_then(|settings| settings.TextScaleFactor()) {
            return factor;
        }
    }
    1.0
}

/// A size the page measured in its own pixels, as the window must be for the page to get it.
pub fn scaled(width: f64, height: f64) -> LogicalSize<f64> {
    let factor = factor();
    LogicalSize::new(width * factor, height * factor)
}

/// Sizes the main window for the factor now, and keeps both windows in step when the slider moves
/// while the app runs (WebView2 rescales the page the moment it does).
pub fn watch(app: &AppHandle, main: (f64, f64), main_min: (f64, f64)) {
    let now = factor();
    if now != 1.0 {
        if let Some(window) = app.get_webview_window(crate::MAIN_WINDOW_LABEL) {
            set_main_min(&window, main_min, now);
            let _ = window.set_size(on_screen(&window, LogicalSize::new(main.0 * now, main.1 * now)));
            let _ = window.center();
        }
    }
    #[cfg(windows)]
    {
        use windows::Foundation::TypedEventHandler;
        use windows::UI::ViewManagement::UISettings;
        let Ok(settings) = UISettings::new() else { return };
        let app = app.clone();
        let mut last = now;
        let handler = TypedEventHandler::new(move |settings: windows::core::Ref<UISettings>, _| {
            let Some(settings) = settings.as_ref() else { return Ok(()) };
            let to = settings.TextScaleFactor()?;
            let from = std::mem::replace(&mut last, to);
            if to != from {
                rescale(&app, from, to, main_min);
            }
            Ok(())
        });
        if settings.TextScaleFactorChanged(&handler).is_ok() {
            // Held for the life of the app: dropping the settings object ends the subscription.
            std::mem::forget(settings);
        }
    }
}

/// The smallest the main window may be: the page's minimum at this factor, but never more than
/// the screen, where the page's own short-window layout takes over.
fn set_main_min(window: &tauri::WebviewWindow, main_min: (f64, f64), factor: f64) {
    let size = on_screen(window, LogicalSize::new(main_min.0 * factor, main_min.1 * factor));
    let _ = window.set_min_size(Some(size));
}

/// `size`, or as much of it as the window's screen has room for.
fn on_screen(window: &tauri::WebviewWindow, size: LogicalSize<f64>) -> LogicalSize<f64> {
    let Ok(Some(monitor)) = window.current_monitor() else { return size };
    let area: LogicalSize<f64> = monitor.work_area().size.to_logical(monitor.scale_factor());
    LogicalSize::new(size.width.min(area.width), size.height.min(area.height))
}

/// The slider moved from `from` to `to`: both windows keep the page size they had.
#[cfg(windows)]
fn rescale(app: &AppHandle, from: f64, to: f64, main_min: (f64, f64)) {
    for label in [crate::MAIN_WINDOW_LABEL, crate::OVERLAY_WINDOW_LABEL] {
        let Some(window) = app.get_webview_window(label) else { continue };
        if label == crate::MAIN_WINDOW_LABEL {
            set_main_min(&window, main_min, to);
        }
        let (Ok(inner), Ok(scale)) = (window.inner_size(), window.scale_factor()) else { continue };
        let size: LogicalSize<f64> = inner.to_logical(scale);
        let _ = window.set_size(on_screen(&window, LogicalSize::new(size.width * to / from, size.height * to / from)));
    }
}
