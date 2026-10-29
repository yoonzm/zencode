use crate::{text, Result};
use semver::Version;
use serde_json::Value;

pub const REPOSITORY: &str = "yoonzm/zencode";

/// Releases without the signed updater manifest predate updater support.
pub fn select_manifest(releases: &[Value], channel: &str, current: &str) -> Result<Option<String>> {
    if !["stable", "beta"].contains(&channel) { return Err("无效更新通道".into()); }
    let current = Version::parse(current).map_err(|e| e.to_string())?;
    let mut candidates = Vec::new();
    for release in releases {
        if release["draft"].as_bool() != Some(false) { continue; }
        let Ok(version) = Version::parse(text(release, "tag_name").trim_start_matches('v')) else { continue; };
        if version <= current || (channel == "stable" && (!version.pre.is_empty() || release["prerelease"] == true)) { continue; }
        let name = if version.pre.is_empty() { "stable.json" } else { "beta.json" };
        if let Some(asset) = release["assets"].as_array().and_then(|a| a.iter().find(|a| text(a, "name") == name)) {
            let expected = format!("https://github.com/{REPOSITORY}/releases/download/{}/{name}", text(release, "tag_name"));
            if text(asset, "browser_download_url") != expected { return Err("更新清单地址不属于发布仓库".into()); }
            candidates.push((version, expected));
        }
    }
    candidates.sort_by(|a,b| b.0.cmp(&a.0));
    Ok(candidates.into_iter().next().map(|(_,url)| url))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn release(v: &str) -> Value {
        let name = if v.contains('-') { "beta.json" } else { "stable.json" };
        json!({"tag_name":format!("v{v}"),"draft":false,"prerelease":v.contains('-'),"assets":[{"name":name,"browser_download_url":format!("https://github.com/{REPOSITORY}/releases/download/v{v}/{name}")}]})
    }
    #[test]
    fn channels_versions_and_legacy_releases() {
        let releases = vec![release("0.9.0"),release("0.10.0"),release("0.11.0-beta.1")];
        assert!(select_manifest(&releases,"stable","0.1.0").unwrap().unwrap().contains("v0.10.0/"));
        assert!(select_manifest(&releases,"beta","0.1.0").unwrap().unwrap().contains("v0.11.0-beta.1/"));
        assert!(select_manifest(&releases,"stable","0.11.0-beta.1").unwrap().is_none());
        let mut legacy = release("1.0.0"); legacy["assets"] = json!([]);
        assert!(select_manifest(&[legacy],"stable","0.1.0").unwrap().is_none());
        let mut draft = release("1.0.0"); draft["draft"] = json!(true);
        assert!(select_manifest(&[draft],"stable","0.1.0").unwrap().is_none());
        assert!(select_manifest(&[],"other","0.1.0").is_err());
    }
}
