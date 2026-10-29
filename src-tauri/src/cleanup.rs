use crate::{text, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn same(a: &Value, b: &Value) -> bool {
    (!a["id"].is_null() && a["id"] == b["id"]) || (!a["no"].is_null() && a["kind"] == b["kind"] && a["no"] == b["no"] && a["repoId"] == b["repoId"])
}
pub fn closed(t: &Value) -> bool {
    matches!(text(t, "ztStatus"), "resolved" | "closed" | "cancelled" | "已解决" | "已完成" | "已关闭" | "已取消" | "已发布")
}
pub fn expired(t: &Value, cutoff: i64) -> bool {
    !matches!(text(&t["run"], "state"), "idle" | "running" | "queued" | "waiting")
        && [t["updatedAt"].as_i64(), t["lastActivityAt"].as_i64(), t["run"]["finishedAt"].as_i64(), t["run"]["startedAt"].as_i64()]
            .into_iter().flatten().max().is_some_and(|at| at < cutoff)
}

// Only direct children of the application's workspace directory can be removed.
pub fn workspace(root: &Path, t: &Value) -> Result<Option<PathBuf>> {
    let raw = text(&t["run"], "worktree");
    if raw.is_empty() { return Ok(None); }
    let path = PathBuf::from(raw);
    let owned = root.join("worktrees");
    if !path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir))
        || path.parent() != Some(owned.as_path()) {
        return Err("拒绝清理应用工作目录以外的路径".into());
    }
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let linked = meta.file_type().is_symlink();
    #[cfg(windows)]
    let linked = { use std::os::windows::fs::MetadataExt; linked || meta.file_attributes() & 0x400 != 0 };
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let parent = owned.canonicalize().map_err(|e| e.to_string())?;
    let expected_parent = root.canonicalize().map_err(|e| e.to_string())?.join("worktrees");
    if parent != expected_parent { return Err("拒绝清理重定向的工作目录".into()); }
    if linked || !meta.is_dir() || canonical.parent() != Some(parent.as_path()) {
        return Err("拒绝清理链接或非独立工作目录".into());
    }
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn excludes_live_and_recent_tasks() {
        for state in ["idle", "running", "queued", "waiting"] {
            assert!(!expired(&json!({"updatedAt":1,"run":{"state":state}}), 100));
        }
        assert!(expired(&json!({"updatedAt":1,"run":{"state":"failed"}}), 100));
        assert!(!expired(&json!({"updatedAt":1,"run":{"state":"failed","finishedAt":101}}), 100));
        assert!(!expired(&json!({"updatedAt":1,"lastActivityAt":101,"run":{"state":"failed"}}), 100));
    }
    #[test]
    fn refuses_external_and_parent_paths() {
        let root = std::env::temp_dir().join("zencode-cleanup-test");
        for path in [root.clone(), root.join("repo"), root.join("worktrees/../repo"), root.join("worktrees")] {
            assert!(workspace(&root, &json!({"run":{"worktree":path}})).is_err());
        }
        assert!(workspace(&root, &json!({"run":{}})).unwrap().is_none());
    }
}
