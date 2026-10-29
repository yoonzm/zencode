use serde_json::json;
use std::sync::Arc;
use zencode_core::{runtime::Runtime, storage::Storage};

#[tokio::test]
async fn organization_import_reload_delete_and_validation() {
    let dir = tempfile::tempdir().unwrap();
    #[cfg(windows)]
    let cli = {
        let js = dir.path().join("node_modules/@openai/codex/bin/codex.js");
        std::fs::create_dir_all(js.parent().unwrap()).unwrap();
        std::fs::write(js, include_str!("fixtures/manual-cli.cjs")).unwrap();
        let cli = dir.path().join("fixture.cmd"); std::fs::write(&cli, "").unwrap(); cli
    };
    #[cfg(unix)]
    let cli = {
        use std::os::unix::fs::PermissionsExt;
        let cli = dir.path().join("fixture");
        std::fs::write(&cli, format!("#!/usr/bin/env node\n{}", include_str!("fixtures/manual-cli.cjs"))).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap(); cli
    };
    let root = dir.path().join("data");
    Storage::new(&root).save(&json!({"tasks":[],"prefs":{"config":{"codex":{"cliPath":cli},"gitlab":{"token":"secret-test-token"},"mappings":[{"product":"P","repos":[{"repo":"team/app","branch":"main"}]}]}}})).unwrap();
    let rt = Runtime::new(root.clone(), Arc::new(|_,_|{})).unwrap();
    for source in ["invalid", "request-tool"] {
        assert!(rt.call("organizeRequirements", json!({"source":source})).await.is_err());
        assert_eq!(rt.data.lock().await["tasks"], json!([]));
    }
    let candidates = rt.call("organizeRequirements", json!({"source":"Export <CSV> with filters"})).await.unwrap();
    assert_eq!(candidates[0]["title"], "Export CSV"); assert_eq!(candidates[0]["on"], true);
    let args = json!({"candidates":candidates,"source":"Export <CSV> with filters"});
    let made = rt.call("importManual", args.clone()).await.unwrap();
    assert_eq!(made[0]["run"]["state"], "idle"); assert_eq!(made[0]["manual"], true);
    let reloaded = Runtime::new(root.clone(), Arc::new(|_,_|{})).unwrap();
    let mut expected = made[0].clone(); expected["run"]["mrBusy"] = json!(false);
    assert_eq!(reloaded.data.lock().await["tasks"][0], expected);
    reloaded.call("delete", json!({"id":made[0]["id"]})).await.unwrap();
    assert_eq!(Storage::new(&root).load().unwrap()["tasks"], json!([]));
    let again = reloaded.call("importManual", args).await.unwrap();
    assert_eq!(again[0]["no"], 2);
    {
        let mut data = reloaded.data.lock().await;
        data["tasks"][0]["updatedAt"] = json!(1);
        data["tasks"][0]["run"]["state"] = json!("failed");
    }
    reloaded.call("cleanup", json!({"mode":"auto","days":30,"products":"all"})).await.unwrap();
    let saved = Storage::new(&root).load().unwrap();
    assert_eq!(saved["tasks"], json!([]));
    assert_eq!(saved["cleanupMarkers"], json!([]), "Manual cleanup must not suppress ZenTao tasks with the same number");
}
