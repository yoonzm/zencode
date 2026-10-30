use crate::Result;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
pub struct Storage {
    path: PathBuf,
    lock: Mutex<()>,
}
impl Storage {
    pub fn new(root: &Path) -> Self {
        Self {
            path: root.join("state.json"),
            lock: Mutex::new(()),
        }
    }
    pub fn load(&self) -> Result<Value> {
        let source = if self.path.exists() {
            self.path.clone()
        } else if self.path.with_extension("bak").exists() {
            self.path.with_extension("bak")
        } else {
            return Ok(json!({"prefs":{},"tasks":[],"products":[]}));
        };
        let data = std::fs::read(&source).map_err(|e| e.to_string())?;
        serde_json::from_slice(&data).map_err(|e| format!("本地状态损坏；原文件未覆盖：{e}"))
    }
    pub fn save(&self, value: &Value) -> Result<()> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let parent = self.path.parent().ok_or("无效存储路径")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        use std::io::Write;
        let mut opts = std::fs::OpenOptions::new();
        opts.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        // Windows rename cannot replace an existing destination. Keep a recoverable backup.
        let backup = self.path.with_extension("bak");
        if self.path.exists() {
            std::fs::copy(&self.path, &backup).map_err(|e| e.to_string())?;
        }
        #[cfg(windows)]
        if self.path.exists() {
            std::fs::remove_file(&self.path).map_err(|e| e.to_string())?;
        }
        std::fs::rename(tmp, &self.path).map_err(|e| e.to_string())
    }
}
pub fn store_secrets(prefs: &Value) -> Result<Value> {
    let mut clean = prefs.clone();
    for (service, path) in [("zentao", "/config/zentao/secret"), ("gitlab", "/config/gitlab/token"), ("feishu-webhook", "/feishu/webhook"), ("feishu-secret", "/feishu/secret")] {
        let secret = prefs.pointer(path).and_then(Value::as_str).unwrap_or("");
        if !secret.is_empty() {
            if cfg!(target_os = "linux") {
                return Err("此版本的安全凭据存储仅支持 Windows/macOS".into());
            }
            keyring::Entry::new("io.github.yoonzm.zencode", service)
                .map_err(|e| e.to_string())?
                .set_password(secret)
                .map_err(|e| format!("系统钥匙串保存失败：{e}"))?;
            *clean.pointer_mut(path).unwrap() = json!("@keyring");
        }
    }
    Ok(clean)
}
pub fn restore_secrets(prefs: &Value) -> Result<Value> {
    let mut restored = prefs.clone();
    for (service, path) in [("zentao", "/config/zentao/secret"), ("gitlab", "/config/gitlab/token"), ("feishu-webhook", "/feishu/webhook"), ("feishu-secret", "/feishu/secret")] {
        if prefs.pointer(path).and_then(Value::as_str) == Some("@keyring") {
            *restored.pointer_mut(path).unwrap() =
                json!(keyring::Entry::new("io.github.yoonzm.zencode", service)
                    .map_err(|e| e.to_string())?
                    .get_password()
                    .map_err(|e| format!("无法读取系统钥匙串：{e}"))?);
        }
    }
    Ok(restored)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn state_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let s = Storage::new(d.path());
        let v = json!({"tasks":[{"id":"bug-1"}],"prefs":{}});
        s.save(&v).unwrap();
        assert_eq!(s.load().unwrap(), v);
        s.save(&json!({"tasks":[]})).unwrap();
        assert!(d.path().join("state.bak").exists());
    }
}
