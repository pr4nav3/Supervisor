//! Supervisor's own updates. The GitHub release's latest.json names the newest version and its
//! installer, signed with the release key whose public half is in tauri.conf.json; the updater
//! refuses anything that key did not sign. A check runs two minutes after launch and then once a
//! day by the clock on the wall (a laptop that sleeps every night still checks daily), and the
//! Settings button runs the same check. Installing waits for the user.

use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Error, UpdaterExt};

/// The newer version on offer, if there is one.
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(check_failed)?;
    Ok(update.map(|update| update.version))
}

/// Plain words for the user; the real reason goes to stderr, where a report can find it.
fn check_failed(error: Error) -> String {
    eprintln!("update check: {error}");
    match error {
        Error::Reqwest(_) => "Could not check for updates. Are you online?",
        Error::ReleaseNotFound | Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            "The update list isn't available right now. Try again later."
        }
        _ => "Could not check for updates right now.",
    }
    .to_string()
}

/// Downloads the new version, installs it and restarts into it. On Windows the installer closes
/// this copy itself.
#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> Result<(), String> {
    // A development build would install the release over the installed copy.
    if cfg!(debug_assertions) {
        return Err("A development build does not update itself.".to_string());
    }
    if in_session(&app) {
        return Err("End the session first, then update.".to_string());
    }
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(check_failed)?
        .ok_or_else(|| "Supervisor is up to date.".to_string())?;
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|error| {
        eprintln!("update download: {error}");
        "The update could not be downloaded. Try again later.".to_string()
    })?;
    // A session begun during the download: on Windows the installer would kill it.
    if in_session(&app) {
        return Err("End the session first, then update.".to_string());
    }
    update.install(bytes).map_err(|error| {
        eprintln!("update install: {error}");
        "The update could not be installed. Try again later.".to_string()
    })?;
    app.restart();
}

/// The daily check. It tells the windows what it found; it never installs.
pub fn start_check(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(120));
        let mut last_check = None;
        loop {
            if check_due(last_check, SystemTime::now()) && !in_session(&app) {
                crate::guarded("app update check", || {
                    if let Ok(Some(version)) = tauri::async_runtime::block_on(check_app_update(app.clone())) {
                        let _ = app.emit("app-update-available", version);
                    }
                });
                last_check = Some(SystemTime::now());
            }
            std::thread::sleep(Duration::from_secs(600));
        }
    });
}

/// A day since the last check by the wall clock, which keeps counting while the machine sleeps;
/// a clock set back counts as due, one early check being harmless.
fn check_due(last_check: Option<SystemTime>, now: SystemTime) -> bool {
    last_check.is_none_or(|last| {
        now.duration_since(last).is_ok_and(|since| since >= Duration::from_secs(24 * 60 * 60))
            || now < last
    })
}

fn in_session(app: &AppHandle) -> bool {
    crate::sessions(&app.state::<crate::AppState>()).has_current()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_daily_check_goes_by_the_wall_clock() {
        let day = Duration::from_secs(24 * 60 * 60);
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        assert!(check_due(None, start));
        assert!(!check_due(Some(start), start + Duration::from_secs(600)));
        assert!(!check_due(Some(start), start + day - Duration::from_secs(1)));
        assert!(check_due(Some(start), start + day));
        // Slept through two nights: still due, since the clock ran while the machine did not.
        assert!(check_due(Some(start), start + 3 * day));
        assert!(check_due(Some(start), start - Duration::from_secs(1)));
    }
}
