use crate::{text, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn root(task: &Value) -> Result<PathBuf> {
    let raw = text(&task["run"], "worktree");
    if raw.is_empty() || task["run"]["cleaned"] == true { return Err("截图工作目录不存在或已清理".into()); }
    std::fs::canonicalize(raw).map_err(|e| e.to_string())
}

fn mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"), _ => None,
    }
}

fn scan(dir: &Path, files: &mut Vec<PathBuf>, depth: usize) {
    if depth > 8 { return; }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue; };
            if kind.is_dir() { scan(&entry.path(), files, depth + 1); }
            else if kind.is_file() && mime(&entry.path()).is_some() { files.push(entry.path()); }
        }
    }
}

pub fn list(task: &Value) -> Result<Value> {
    let root = root(task)?;
    let declared = task["run"]["verify"]["shots"].as_array().cloned().unwrap_or_default();
    let mut files: Vec<PathBuf> = declared.iter().map(|s| root.join(text(s, "path"))).collect();
    // Older reports only mention filenames in prose. Discover their evidence directory too.
    let evidence = root.join(".verification");
    if evidence.canonicalize().is_ok_and(|p| p.starts_with(&root)) { scan(&evidence, &mut files, 0); }
    let mut shots = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for file in files {
        let Ok(path) = file.canonicalize() else { continue; };
        if !path.starts_with(&root) || !path.is_file() || mime(&path).is_none() || !seen.insert(path.clone()) { continue; }
        let relative = path.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
        let meta = declared.iter().find(|s| root.join(text(s, "path")).canonicalize().ok().as_ref() == Some(&path));
        let label = meta.map(|s| text(s, "label")).filter(|s| !s.is_empty()).unwrap_or(&relative);
        shots.push(json!({"id":relative,"path":relative,"label":label,"failed":meta.is_some_and(|s| s["failed"] == true)}));
    }
    shots.sort_by(|a,b| text(a,"path").cmp(text(b,"path")));
    Ok(json!(shots))
}

pub fn read(task: &Value, requested: &str) -> Result<String> {
    if !list(task)?.as_array().unwrap().iter().any(|s| text(s,"path") == requested) {
        return Err("截图不在当前任务的验证证据中".into());
    }
    let root = root(task)?;
    let path = root.join(requested).canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&root) { return Err("截图不在任务工作目录中".into()); }
    use std::io::Read;
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(20 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 20 * 1024 * 1024 { return Err("截图超过 20 MB，无法预览".into()); }
    Ok(format!("data:{};base64,{}", mime(&path).ok_or("不支持的截图格式")?, STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_legacy_and_declared_shots_but_rejects_escape() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("task");
        std::fs::create_dir_all(workspace.join(".verification/bug-1")).unwrap();
        std::fs::write(workspace.join(".verification/bug-1/step.png"), b"png").unwrap();
        std::fs::write(workspace.join("extra.jpg"), b"jpg").unwrap();
        std::fs::write(dir.path().join("outside.png"), b"secret").unwrap();
        let task = json!({"run":{"worktree":workspace,"verify":{"shots":[
            {"path":"extra.jpg","label":"提交失败","failed":true},{"path":"../outside.png"},
            {"path":".verification/bug-1/step.png"},{"path":"missing.png"}]}}});
        let shots = list(&task).unwrap();
        assert_eq!(shots.as_array().unwrap().len(), 2);
        assert_eq!(shots[1]["label"], "提交失败");
        assert_eq!(shots[1]["failed"], true);
        assert!(read(&task,"extra.jpg").unwrap().starts_with("data:image/jpeg;base64,"));
        assert!(read(&task,"../outside.png").is_err());
        std::fs::remove_file(workspace.join("extra.jpg")).unwrap();
        assert!(read(&task,"extra.jpg").is_err());
    }
}
