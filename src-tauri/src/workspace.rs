use crate::{services::command, text, Result};
use serde_json::{json, Value};
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
    run["repositories"].as_array().cloned().unwrap_or_else(|| {
        if text(run, "worktree").is_empty() { vec![] } else {
            vec![json!({"mapping":run["mapping"],"worktree":run["worktree"],"base":run["base"],"branch":run["branch"],"mr":run["mr"],"path":""})]
        }
    })
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

/// Keep the most useful existing task ID/session; archive every removed row intact.
pub fn migrate(data: &mut Value) -> bool {
    if data["taskModel"] == "product-v1" { return false; }
    let old = data["tasks"].as_array().cloned().unwrap_or_default();
    let mut groups: Vec<Vec<Value>> = Vec::new();
    for task in old {
        let group = groups.iter_mut().find(|g| {
            let first = &g[0];
            if task["no"].is_null() || task["kind"].is_null() { return first["id"] == task["id"]; }
            first["kind"] == task["kind"] && first["no"] == task["no"]
                && first["manual"].as_bool().unwrap_or(false) == task["manual"].as_bool().unwrap_or(false)
                && (task["manual"] != true || (first["source"] == task["source"] && first["product"] == task["product"]))
        });
        if let Some(group) = group { group.push(task); } else { groups.push(vec![task]); }
    }
    let mut tasks = Vec::new();
    for mut group in groups {
        let score = |t: &Value| (
            matches!(text(&t["run"], "state"), "running" | "queued" | "waiting"),
            !t["run"]["mr"].is_null(),
            text(&t["run"], "state") != "idle",
            !text(&t["run"], "worktree").is_empty(),
            t["lastActivityAt"].as_i64().unwrap_or(0).max(t["updatedAt"].as_i64().unwrap_or(0)),
        );
        let index = group.iter().enumerate().max_by_key(|(_, t)| score(t)).map(|(i, _)| i).unwrap();
        let mut task = group.remove(index);
        if !group.is_empty() {
            task["legacyRepositoryTasks"] = json!(group);
        }
        tasks.push(task);
    }
    data["tasks"] = json!(tasks);
    data["taskModel"] = json!("product-v1");
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_keeps_completed_run_and_all_old_records_and_is_idempotent() {
        let idle = json!({"id":"story-7-a","kind":"story","no":7,"repoId":"a","run":{"state":"idle"}});
        let done = json!({"id":"story-7-b","kind":"story","no":7,"repoId":"b","run":{"state":"completed","worktree":"kept","events":[1]}});
        let manual = json!({"id":"manual-7","manual":true,"kind":"story","no":7,"run":{"state":"review"}});
        let mut data = json!({"tasks":[idle.clone(),done.clone(),manual]});
        assert!(migrate(&mut data));
        assert_eq!(data["tasks"].as_array().unwrap().len(),2);
        assert_eq!(data["tasks"][0]["id"],done["id"]);
        assert_eq!(data["tasks"][0]["run"],done["run"]);
        assert_eq!(data["tasks"][0]["legacyRepositoryTasks"],json!([idle]));
        let migrated = data.clone();
        assert!(!migrate(&mut data)); assert_eq!(data,migrated);
    }
    #[test]
    fn six_sources_with_twenty_three_repos_collapse_without_losing_any_row() {
        let mut tasks = Vec::new();
        for no in 1..=6 {
            for repo in 1..=23 { tasks.push(json!({"id":format!("story-{no}-{repo}"),"kind":"story","no":no,"repoId":repo,"run":{"state":if repo == 1 && no <= 3 {"completed"} else {"idle"}}})); }
        }
        for no in 1..=5 { tasks.push(json!({"id":format!("manual-{no}"),"manual":true,"kind":"story","no":no,"run":{"state":"review"}})); }
        let mut data = json!({"tasks":tasks});
        migrate(&mut data);
        let tasks = data["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(),11);
        let archived: usize = tasks.iter().map(|t| t["legacyRepositoryTasks"].as_array().map_or(0,Vec::len)).sum();
        assert_eq!(tasks.len()+archived,143);
        assert_eq!(tasks.iter().filter(|t| t["run"]["state"] == "completed").count(),3);
    }
    #[test]
    fn repository_links_deduplicate_and_directory_names_do_not_collide() {
        assert_eq!(links(&json!({"repos":[{"repo":"a/app","branch":"main"},{"repo":"a/app","branch":"main"},{"repo":"b/app","branch":"dev"}]})).unwrap().len(),2);
        assert_ne!(directory("a/app"),directory("b/app"));
        assert!(links(&json!({"repos":[{"repo":"a/app","branch":""}]})).is_err());
    }
}
