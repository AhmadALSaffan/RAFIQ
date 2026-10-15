//! Checking for a new version on the channel the user picked, and installing it.
//!
//! Stable reads the manifest attached to the latest stable release on GitHub. Beta reads a
//! manifest kept in the repository that always names the newest build, beta or stable, so
//! a beta user never falls behind a stable release. Either way Tauri verifies the build's
//! signature against the public key in tauri.conf.json before running anything.

use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

const STABLE: &str = "https://github.com/AhmadALSaffan/RAFIQ/releases/latest/download/latest.json";
const BETA: &str = "https://raw.githubusercontent.com/AhmadALSaffan/RAFIQ/main/updates/beta.json";

/// The update the last check found, so installing uses exactly what the user saw.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct Found {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum Progress {
    Started { total: Option<u64> },
    Chunk { length: usize },
    Finished,
}

fn endpoint(channel: &str) -> Result<Url, String> {
    let url = if channel == "beta" { BETA } else { STABLE };
    Url::parse(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_update(app: AppHandle, channel: String, pending: State<'_, Pending>) -> Result<Option<Found>, String> {
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint(&channel)?])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let found = update.as_ref().map(|u| Found {
        version: u.version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    *pending.0.lock().map_err(|e| e.to_string())? = update;
    Ok(found)
}

#[tauri::command]
pub async fn install_update(pending: State<'_, Pending>, on_progress: Channel<Progress>) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "no update to install — check again".to_string())?;
    let mut started = false;
    update
        .download_and_install(
            |length, total| {
                if !started {
                    started = true;
                    let _ = on_progress.send(Progress::Started { total });
                }
                let _ = on_progress.send(Progress::Chunk { length });
            },
            || {
                let _ = on_progress.send(Progress::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())
}
