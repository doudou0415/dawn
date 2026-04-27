use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::Mutex;

// ─── IPC 心跳状态 ─────────────────────────────────────────

struct IpcState {
    last_heartbeat: AtomicU64,
    connected: Mutex<bool>,
}

#[derive(Serialize)]
struct IpcStatus {
    connected: bool,
    last_heartbeat_ms: u64,
    uptime_ms: u64,
}

#[tauri::command]
async fn get_ipc_status(state: tauri::State<'_, IpcState>) -> IpcStatus {
    let last = state.last_heartbeat.load(Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let connected = *state.connected.lock().await;
    IpcStatus {
        connected,
        last_heartbeat_ms: last,
        uptime_ms: if last > 0 { now.saturating_sub(last) } else { 0 },
    }
}

#[tauri::command]
async fn ipc_heartbeat(state: tauri::State<'_, IpcState>) -> Result<String, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    state.last_heartbeat.store(now, Ordering::Relaxed);
    let mut connected = state.connected.lock().await;
    *connected = true;
    Ok("pong".into())
}

// ─── 原有命令 ─────────────────────────────────────────────

#[derive(Deserialize)]
struct RunFullTaskResponse {
    response: String,
    side_panel: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct RunFullTaskResult {
    response: String,
    side_panel: Option<serde_json::Value>,
}

fn apply_hotkey(app: &tauri::AppHandle, hotkey: String) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();

    let normalized = hotkey
        .replace("Ctrl", "ctrl")
        .replace("Shift", "shift")
        .replace("Alt", "alt")
        .replace("Meta", "super")
        .to_lowercase();

    let parsed: Shortcut = normalized
        .parse()
        .map_err(|_| format!("快捷键无效: {hotkey}（示例：ctrl+shift+d）"))?;

    shortcuts
        .on_shortcut(parsed, |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            toggle_main_window(&app);
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn register_hotkey(app: tauri::AppHandle, hotkey: String) -> Result<(), String> {
    apply_hotkey(&app, hotkey)
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let visible = win.is_visible().unwrap_or(true);
    if visible {
        let _ = win.hide();
    } else {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// 通过 HTTP 调用 DawnNew 后端（Bun 服务，端口 3457）执行完整任务
#[tauri::command]
async fn run_full_task(task: String) -> Result<RunFullTaskResult, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "task": task });

    let resp = client
        .post("http://localhost:3457/api/runFullTask")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("连接后端失败: {e}（请确认后端已启动: bun run src/backend.ts）"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("后端返回错误 ({}): {}", status, err_text));
    }

    let result: RunFullTaskResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {e}"))?;

    Ok(RunFullTaskResult {
        response: result.response,
        side_panel: result.side_panel,
    })
}

/// 读取本地 UTF-8 文本文件；超过 max_bytes 时返回 None
#[tauri::command]
fn read_local_text_file(path: String, max_bytes: u64) -> Result<Option<String>, String> {
    use std::fs;
    let meta = fs::metadata(&path).map_err(|e| format!("无法访问路径: {e}"))?;
    if meta.len() > max_bytes {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("读取失败: {e}"))
}

/// 写入本地 UTF-8 文本文件（自动创建父目录）
#[tauri::command]
fn write_local_text_file(path: String, content: String) -> Result<(), String> {
    use std::fs;
    let p = std::path::PathBuf::from(path.trim());
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&p, content.as_bytes()).map_err(|e| format!("写入失败: {e}"))
}

#[derive(Serialize)]
struct LocalPathStat {
    exists: bool,
    is_file: bool,
    is_dir: bool,
}

#[tauri::command]
fn stat_local_path(path: String) -> Result<LocalPathStat, String> {
    use std::fs;
    match fs::metadata(&path) {
        Ok(meta) => Ok(LocalPathStat {
            exists: true,
            is_file: meta.is_file(),
            is_dir: meta.is_dir(),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LocalPathStat {
            exists: false,
            is_file: false,
            is_dir: false,
        }),
        Err(e) => Err(format!("读取路径状态失败: {e}")),
    }
}

#[tauri::command]
fn list_local_dir(path: String) -> Result<Vec<String>, String> {
    use std::fs;
    let entries = fs::read_dir(&path).map_err(|e| format!("读取目录失败: {e}"))?;
    let mut files = Vec::new();
    for ent in entries {
        let ent = ent.map_err(|e| format!("读取目录项失败: {e}"))?;
        let file_name = ent.file_name().to_string_lossy().to_string();
        files.push(file_name);
    }
    Ok(files)
}

#[derive(Serialize)]
struct WorkspaceNode {
    name: String,
    path: String,
    node_type: String,
    children: Option<Vec<WorkspaceNode>>,
}

fn build_workspace_tree(dir: &std::path::Path, depth: u32) -> Result<Vec<WorkspaceNode>, String> {
    if depth == 0 {
        return Ok(Vec::new());
    }
    let mut out: Vec<WorkspaceNode> = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| format!("读取目录失败: {e}"))?;
    for ent in entries {
        let ent = ent.map_err(|e| format!("读取目录项失败: {e}"))?;
        let p = ent.path();
        let name = ent.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }
        let meta = ent.metadata().map_err(|e| format!("读取文件元信息失败: {e}"))?;
        if meta.is_dir() {
            let children = build_workspace_tree(&p, depth - 1)?;
            out.push(WorkspaceNode {
                name,
                path: p.to_string_lossy().to_string(),
                node_type: "dir".into(),
                children: Some(children),
            });
        } else {
            out.push(WorkspaceNode {
                name,
                path: p.to_string_lossy().to_string(),
                node_type: "file".into(),
                children: None,
            });
        }
    }
    out.sort_by(|a, b| {
        if a.node_type != b.node_type {
            return if a.node_type == "dir" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(out)
}

#[tauri::command]
fn get_workspace_tree(root: String, max_depth: u32) -> Result<Vec<WorkspaceNode>, String> {
    let p = std::path::PathBuf::from(root);
    if !p.exists() {
        return Err("workspace root does not exist".into());
    }
    if !p.is_dir() {
        return Err("workspace root is not a directory".into());
    }
    let depth = max_depth.clamp(1, 6);
    build_workspace_tree(&p, depth)
}

#[tauri::command]
fn create_workspace_entry(parent: String, name: String, kind: String) -> Result<String, String> {
    let parent_path = std::path::PathBuf::from(parent.trim());
    if !parent_path.exists() || !parent_path.is_dir() {
        return Err("parent directory does not exist".into());
    }
    let name_trim = name.trim();
    if name_trim.is_empty() {
        return Err("name is required".into());
    }
    if name_trim.contains("..") || name_trim.contains('\\') || name_trim.contains('/') {
        return Err("invalid name".into());
    }
    let target = parent_path.join(name_trim);
    if target.exists() {
        return Err("target already exists".into());
    }
    match kind.as_str() {
        "dir" => {
            std::fs::create_dir(&target).map_err(|e| format!("create directory failed: {e}"))?;
        }
        "file" => {
            std::fs::File::create(&target).map_err(|e| format!("create file failed: {e}"))?;
        }
        _ => return Err("invalid kind".into()),
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_workspace_entry(target: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(target.trim());
    if !p.exists() {
        return Err("target does not exist".into());
    }
    let meta = std::fs::metadata(&p).map_err(|e| format!("read metadata failed: {e}"))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| format!("delete directory failed: {e}"))?;
    } else {
        std::fs::remove_file(&p).map_err(|e| format!("delete file failed: {e}"))?;
    }
    Ok(())
}

// ─── 应用入口 ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ipc_state = Arc::new(IpcState {
        last_heartbeat: AtomicU64::new(0),
        connected: Mutex::new(false),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(ipc_state)
        .invoke_handler(tauri::generate_handler![
            run_full_task,
            register_hotkey,
            read_local_text_file,
            write_local_text_file,
            stat_local_path,
            list_local_dir,
            get_workspace_tree,
            create_workspace_entry,
            delete_workspace_entry,
            get_ipc_status,
            ipc_heartbeat,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

            let show_i = MenuItem::with_id(app, "show", "显示面板", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::new().menu(&menu).tooltip("DawnNew Panel");
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder
                .on_menu_event({
                    let app_handle = app_handle.clone();
                    move |app, event| match event.id.as_ref() {
                        "show" => {
                            toggle_main_window(&app_handle);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        toggle_main_window(app);
                    }
                })
                .build(app)?;

            let _ = apply_hotkey(&app_handle, "ctrl+shift+d".into());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DawnNew Panel");
}
