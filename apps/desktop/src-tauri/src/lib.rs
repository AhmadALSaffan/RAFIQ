use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

mod file_icon;

use rand::RngCore;
use serde::Serialize;
use tauri::{Manager, State};

#[derive(Clone, Serialize)]
struct ApiConfig {
    base_url: String,
    token: String,
}

struct SidecarState {
    config: ApiConfig,
    child: Mutex<Option<Child>>,
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind an ephemeral port")
        .local_addr()
        .expect("failed to read local address")
        .port()
}

/// Locates the agent's venv Python interpreter relative to this crate during
/// `cargo tauri dev`.
fn agent_python_and_dir() -> (PathBuf, PathBuf) {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let agent_dir = manifest_dir
        .join("..")
        .join("..")
        .join("agent")
        .canonicalize()
        .expect("could not locate ../../agent — is the Rafiq monorepo layout intact?");
    let python = agent_dir.join(".venv").join("Scripts").join("python.exe");
    (python, agent_dir)
}

/// Starts the backend: the PyInstaller-built `rafiq-agent.exe` that ships inside the
/// installed app, or the repo's venv during `tauri dev`. An installed copy has no Python
/// and no monorepo, so the bundled binary is the only thing it can run.
fn spawn_backend(app: &tauri::AppHandle, port: u16, token: &str) -> Child {
    // Dev always runs the repo's venv so Python edits apply on restart; the frozen binary
    // is for the installed app.
    let bundled = if cfg!(debug_assertions) {
        None
    } else {
        app.path()
            .resolve("agent/rafiq-agent.exe", tauri::path::BaseDirectory::Resource)
            .ok()
            .filter(|path| path.is_file())
    };

    let mut command = match bundled {
        Some(binary) => {
            let mut c = Command::new(&binary);
            c.arg("--port").arg(port.to_string());
            if let Some(dir) = binary.parent() {
                c.current_dir(dir);
            }
            c
        }
        None => {
            let (python, agent_dir) = agent_python_and_dir();
            let mut c = Command::new(python);
            c.args(["-m", "uvicorn", "rafiq_agent.main:app", "--port", &port.to_string()])
                .current_dir(agent_dir);
            c
        }
    };

    command.env("RAFIQ_TOKEN", token);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW — no console flashing behind the app.
        command.creation_flags(0x0800_0000);
    }

    command
        .spawn()
        .expect("failed to start the Rafiq agent backend")
}

#[tauri::command]
fn get_api_config(state: State<SidecarState>) -> ApiConfig {
    state.config.clone()
}

/// Windows' own icon for a file type, as a data URL. `name` is just "file.ext".
#[tauri::command]
fn system_file_icon(name: String) -> Option<String> {
    file_icon::data_url(&name)
}

/// Writes a UTF-8 text file the user picked a path for (chat export).
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("ما قدرت أحفظ الملف: {e}"))
}

/// Opens a folder (or a file's folder) in the system file manager.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("ما لقيت المسار: {path}"));
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("explorer.exe");
        if target.is_dir() {
            command.arg(&target);
        } else {
            command.arg("/select,").arg(&target);
        }
        // explorer returns a non-zero code even when it works, so only the spawn matters.
        command.spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        Err("مدعوم على ويندوز فقط".into())
    }
}

/// Opens a web link in the user's default browser. The webview itself never navigates
/// away from the app, so every external link goes through here. Only http(s) is allowed —
/// anything else (file:, javascript:, custom schemes) is refused rather than handed to the shell.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("بس روابط http و https".into());
    }
    if url.chars().any(|c| c.is_whitespace() || c == '"' || c.is_control()) {
        return Err("الرابط فيه رموز مش مسموحة".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // url.dll hands the link to whatever browser the user set as default.
        Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(&url)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        Err("مدعوم على ويندوز فقط".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_api_config,
            system_file_icon,
            save_text_file,
            reveal_path,
            open_external
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // The backend starts here, not before the builder, because finding the bundled
            // binary needs the app's resource directory.
            let port = free_port();
            let token = generate_token();
            let child = spawn_backend(app.handle(), port, &token);
            app.manage(SidecarState {
                config: ApiConfig { base_url: format!("http://127.0.0.1:{port}"), token },
                child: Mutex::new(Some(child)),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: State<SidecarState> = window.state();
                let taken = state.child.lock().unwrap().take();
                if let Some(mut child) = taken {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
