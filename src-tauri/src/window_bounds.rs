use tauri::{LogicalSize, Manager, PhysicalPosition, WebviewWindow};

const WINDOW_SCREEN_MARGIN: u32 = 48;
const RESTORED_WINDOW_MAX_SCREEN_RATIO: f64 = 0.9;

fn clamp_axis(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

pub(crate) fn max_window_axis(work_area_axis: f64, min_axis: f64) -> f64 {
    (work_area_axis * RESTORED_WINDOW_MAX_SCREEN_RATIO)
        .round()
        .min((work_area_axis - WINDOW_SCREEN_MARGIN as f64).max(min_axis))
        .max(work_area_axis / 2.0)
        .max(min_axis)
}

pub(crate) fn restored_window_axis(
    current_axis: f64,
    work_area_axis: f64,
    default_axis: f64,
    min_axis: f64,
) -> f64 {
    let max_axis = max_window_axis(work_area_axis, min_axis);
    if current_axis > work_area_axis - WINDOW_SCREEN_MARGIN as f64 {
        return default_axis.min(max_axis).max(min_axis);
    }

    current_axis.min(max_axis).max(min_axis)
}

fn clamp_main_window_to_visible_area(window: &WebviewWindow) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_fullscreen()? {
        return Ok(());
    }

    let Some(monitor) = window
        .current_monitor()?
        .or(window.primary_monitor()?)
        .or_else(|| window.available_monitors().ok()?.into_iter().next())
    else {
        return Ok(());
    };

    let work_area = *monitor.work_area();
    let current_size = window.inner_size()?;
    let scale_factor = monitor.scale_factor();
    let current_logical_size = current_size.to_logical::<f64>(scale_factor);
    let work_area_logical_size = work_area.size.to_logical::<f64>(scale_factor);
    let clamped_logical_size = LogicalSize {
        width: restored_window_axis(
            current_logical_size.width,
            work_area_logical_size.width,
            1280.0,
            960.0,
        ),
        height: restored_window_axis(
            current_logical_size.height,
            work_area_logical_size.height,
            800.0,
            640.0,
        ),
    };
    let clamped_size = clamped_logical_size.to_physical::<u32>(scale_factor);
    if clamped_size != current_size {
        window.set_size(clamped_logical_size)?;
    }

    let current_position = window.outer_position()?;
    let max_x =
        work_area.position.x + work_area.size.width.saturating_sub(clamped_size.width) as i32;
    let max_y =
        work_area.position.y + work_area.size.height.saturating_sub(clamped_size.height) as i32;
    let clamped_position = PhysicalPosition {
        x: clamp_axis(current_position.x, work_area.position.x, max_x),
        y: clamp_axis(current_position.y, work_area.position.y, max_y),
    };
    if clamped_position != current_position {
        window.set_position(clamped_position)?;
    }

    Ok(())
}

pub(crate) fn schedule_main_window_bounds_clamp(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = clamp_main_window_to_visible_area(&window);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{max_window_axis, restored_window_axis};

    #[test]
    fn keeps_restored_windows_below_screen_width() {
        assert_eq!(max_window_axis(1512.0, 960.0), 1361.0);
    }

    #[test]
    fn handles_tiny_monitors() {
        assert_eq!(max_window_axis(40.0, 1.0), 20.0);
    }

    #[test]
    fn restores_sensible_window_sizes() {
        assert_eq!(restored_window_axis(1520.0, 1512.0, 1280.0, 960.0), 1280.0);
        assert_eq!(restored_window_axis(1161.0, 1512.0, 1280.0, 960.0), 1161.0);
        assert_eq!(restored_window_axis(480.0, 1512.0, 1280.0, 960.0), 960.0);
        assert_eq!(restored_window_axis(1.0, 40.0, 1280.0, 1.0), 20.0);
    }
}
