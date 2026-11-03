use crate::{services::command, text, Result};
use serde_json::Value;
use std::{collections::HashSet, path::Path};

pub fn links(mapping: &Value) -> Result<Vec<Value>> {
    let candidates = mapping["repos"].as_array().cloned().unwrap_or_else(|| vec![mapping.clone()]);
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for repo in candidates {
        if text(&repo, "repo").is_empty() || text(&repo, "branch").is_empty() {
            return Err("请补全产品的全部仓库和分支配置".into());
        }
        if seen.insert(text(&repo, "repo").to_owned()) { result.push(repo); }
    }
    if result.is_empty() { return Err("请先配置此产品的仓库映射".into()); }
    Ok(result)
}

// A task owns one workspace and one Codex session. Each repository keeps its own Git metadata.
pub fn repositories(run: &Value) -> Vec<Value> {
    run["repositories"].as_array().cloned().unwrap_or_default()
}

pub fn directory(repo: &str) -> String {
    use sha2::{Digest, Sha256};
    let label: String = repo.rsplit('/').next().unwrap_or("repo").chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(32).collect();
    let digest = format!("{:x}", Sha256::digest(repo.as_bytes()));
    format!("{label}-{}", &digest[..12])
}

pub async fn diff(repo: &Value) -> Result<String> {
    let cwd = Path::new(text(repo, "worktree"));
    command("git", &["add", "-N", "--", ".", ":(top,exclude).verification", ":(top,exclude).zencode-repos"], Some(cwd)).await?;
    let prefix = text(repo, "path");
    let src = if prefix.is_empty() { "a/".to_owned() } else { format!("a/{prefix}/") };
    let dst = if prefix.is_empty() { "b/".to_owned() } else { format!("b/{prefix}/") };
    command("git", &["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-color", &format!("--src-prefix={src}"), &format!("--dst-prefix={dst}"), text(repo, "base"), "--", ".", ":(top,exclude).verification", ":(top,exclude).zencode-repos"], Some(cwd)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn repositories_use_explicit_workspace_records() {
        assert!(repositories(&json!({"worktree":"task","mapping":{"repo":"a/app"}})).is_empty());
        let entries = json!([{"worktree":"task/repo","mapping":{"repo":"a/app"},"base":"commit"}]);
        assert_eq!(repositories(&json!({"repositories":entries})),entries.as_array().unwrap().clone());
    }
    #[test]
    fn repository_links_deduplicate_and_directory_names_do_not_collide() {
        assert_eq!(links(&json!({"repos":[{"repo":"a/app","branch":"main"},{"repo":"a/app","branch":"main"},{"repo":"b/app","branch":"dev"}]})).unwrap().len(),2);
        assert_ne!(directory("a/app"),directory("b/app"));
        assert!(links(&json!({"repos":[{"repo":"a/app","branch":""}]})).is_err());
    }
}
