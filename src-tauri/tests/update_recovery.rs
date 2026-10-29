use serde_json::json;
use std::sync::Arc;
use zencode_core::{runtime::Runtime, storage::Storage};

#[tokio::test]
async fn update_gate_preserves_manual_pause_and_rejects_waiting_approvals() {
    let root = tempfile::tempdir().unwrap();
    Storage::new(root.path()).save(&json!({"prefs":{},"tasks":[{"id":"paused","run":{"state":"paused","events":[],"threadId":"keep"}}]})).unwrap();
    let rt = Runtime::new(root.path().into(), Arc::new(|_,_| {})).unwrap();
    assert_eq!(rt.data.lock().await["tasks"][0]["run"]["state"], "paused");
    rt.data.lock().await["tasks"][0]["run"]["state"] = json!("waiting");
    assert!(rt.prepare_update("0.2.0").await.unwrap_err().contains("审批"));
    rt.data.lock().await["tasks"][0]["run"]["state"] = json!("paused");
    rt.prepare_update("0.2.0").await.unwrap();
    assert_eq!(rt.data.lock().await["updateResume"]["ids"], json!([]));
    assert!(rt.call("start", json!({})).await.unwrap_err().contains("更新"));
    assert!(rt.call("load", json!({})).await.is_ok());
    rt.cancel_update().await.unwrap();
    assert!(rt.data.lock().await["updateResume"].is_null());
    assert!(!rt.call("start", json!({})).await.unwrap_err().contains("更新"));
}

#[tokio::test]
async fn wrong_version_never_resumes_and_empty_matching_checkpoint_is_consumed() {
    let root = tempfile::tempdir().unwrap();
    Storage::new(root.path()).save(&json!({"prefs":{},"tasks":[],"updateResume":{"version":"999.0.0","ids":[]}})).unwrap();
    let rt = Runtime::new(root.path().into(), Arc::new(|_,_| {})).unwrap();
    rt.call("resumeAfterUpdate", json!({})).await.unwrap();
    assert_eq!(rt.data.lock().await["updateResume"]["version"], "999.0.0");
    rt.data.lock().await["updateResume"]["version"] = json!(env!("CARGO_PKG_VERSION"));
    rt.call("resumeAfterUpdate", json!({})).await.unwrap();
    assert!(Storage::new(root.path()).load().unwrap()["updateResume"].is_null());
}
