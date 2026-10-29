use serde_json::{json, Value};
use std::sync::Arc;
use zencode_core::{
    runtime::Runtime,
    services::{command, empty_run},
    storage::Storage,
};
async fn state(rt: &Arc<Runtime>, expected: &str) -> Value {
    for _ in 0..500 {
        let d = rt.data.lock().await.clone();
        if d["tasks"][0]["run"]["state"] == expected {
            return d["tasks"][0].clone();
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!(
        "State never reached {expected}: {}",
        rt.data.lock().await["tasks"][0]
    );
}
#[cfg(unix)]
#[tokio::test]
async fn approval_pause_resume_worktree_diff_and_restart() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let repo = root.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    command("git", &["init", "-b", "main"], Some(&repo))
        .await
        .unwrap();
    command(
        "git",
        &["config", "user.email", "test@example.invalid"],
        Some(&repo),
    )
    .await
    .unwrap();
    command("git", &["config", "user.name", "Test"], Some(&repo))
        .await
        .unwrap();
    std::fs::write(repo.join("hello.txt"), "original\n").unwrap();
    command("git", &["add", "."], Some(&repo)).await.unwrap();
    command("git", &["commit", "-m", "initial"], Some(&repo))
        .await
        .unwrap();
    let cli = root.path().join("codex-fixture");
    std::fs::write(&cli,r#"#!/usr/bin/env python3
import sys,json,pathlib
def send(v): print(json.dumps(v),flush=True)
for line in sys.stdin:
 r=json.loads(line); m=r.get('method'); i=r.get('id');p=r.get('params',{})
 if m=='initialize': send({'id':i,'result':{'userAgent':'fixture'}})
 elif m in ['thread/start','thread/resume']: send({'id':i,'result':{'thread':{'id':'test-thread'}}})
 elif m=='turn/start':
  send({'id':i,'result':{'turn':{'id':'test-turn'}}})
  send({'id':700,'method':'item/commandExecution/requestApproval','params':{'command':'write hello.txt','reason':'fixture approval','threadId':'test-thread','turnId':'test-turn','itemId':'cmd'}})
 elif m=='turn/interrupt':
  send({'id':i,'result':{}})
  send({'method':'turn/completed','params':{'turn':{'status':'interrupted','id':'test-turn'}}})
 elif i==700 and 'result' in r:
  if r['result']['decision'] not in ['accept','acceptForSession']: continue
  pathlib.Path('hello.txt').write_text('changed\n');pathlib.Path('added.txt').write_text('new\n')
  send({'method':'item/agentMessage/delta','params':{'itemId':'msg','delta':'Done'}})
  send({'method':'turn/completed','params':{'turn':{'status':'completed','id':'test-turn'}}})
"#).unwrap();
    std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
    let data = root.path().join("data");
    let initial = json!({"prefs":{},"products":[],"tasks":[{"id":"bug-1","no":1,"kind":"bug","title":"Fix","product":"P","description":[],"run":empty_run()}]});
    Storage::new(&data).save(&initial).unwrap();
    let rt = Runtime::new(data.clone(), Arc::new(|_, _| {})).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let clone_repo = repo.clone();
    tokio::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0; 4096];
            socket.read(&mut buf).await.unwrap();
            let body = json!({"http_url_to_repo":clone_repo}).to_string();
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).as_bytes()).await.unwrap();
        }
    });
    let config = json!({"gitlab":{"baseUrl":base_url,"token":"fixture"},"codex":{"cliPath":cli,"sandbox":"workspace-write","model":"fixture","concurrency":1},"mappings":[{"product":"P","repo":"team/app","branch":"main","testCmd":""}]});
    rt.call("start", json!({"id":"bug-1","config":config}))
        .await
        .unwrap();
    state(&rt, "waiting").await;
    rt.call("pause", json!({"id":"bug-1"})).await.unwrap();
    state(&rt, "paused").await;
    // Wait until the previous worker releases the job entry.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    rt.call("start", json!({"id":"bug-1","config":config}))
        .await
        .unwrap();
    let t = state(&rt, "waiting").await;
    let event = t["run"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|e| e["kind"] == "approval")
        .unwrap();
    rt.call(
        "approve",
        json!({"id":"bug-1","evId":event["id"],"decision":"once"}),
    )
    .await
    .unwrap();
    let done = state(&rt, "review").await;
    assert!(done["run"]["rawDiff"]
        .as_str()
        .unwrap()
        .contains("+changed"));
    assert!(done["run"]["rawDiff"]
        .as_str()
        .unwrap()
        .contains("added.txt"));
    assert_eq!(
        std::fs::read_to_string(repo.join("hello.txt")).unwrap(),
        "original\n"
    );
    assert!(!repo.join("added.txt").exists());
    assert_eq!(done["run"]["threadId"], "test-thread");
    assert!(rt
        .call(
            "approve",
            json!({"id":"bug-1","evId":event["id"],"decision":"once"})
        )
        .await
        .is_err());
    rt.shutdown().await;
    let recovered = Runtime::new(data, Arc::new(|_, _| {})).unwrap();
    assert_eq!(
        recovered.data.lock().await["tasks"][0]["run"]["state"],
        "review"
    );
    recovered.call("start", json!({"id":"bug-1","config":config})).await.unwrap();
    state(&recovered, "waiting").await;
    tokio::time::timeout(std::time::Duration::from_secs(5), recovered.call("delete", json!({"id":"bug-1"})))
        .await.unwrap().unwrap();
    assert!(recovered.data.lock().await["tasks"].as_array().unwrap().is_empty());
    assert_eq!(std::fs::read_to_string(repo.join("hello.txt")).unwrap(), "original\n");
}
#[tokio::test]
async fn crash_recovery_preserves_worktree() {
    let dir = tempfile::tempdir().unwrap();
    let mut run = empty_run();
    run["state"] = json!("running");
    run["worktree"] = json!("/retained/worktree");
    Storage::new(dir.path())
        .save(&json!({"prefs":{},"tasks":[{"id":"bug-1","run":run}]}))
        .unwrap();
    let rt = Runtime::new(dir.path().into(), Arc::new(|_, _| {})).unwrap();
    let data = rt.data.lock().await;
    assert_eq!(data["tasks"][0]["run"]["state"], "failed");
    assert_eq!(data["tasks"][0]["run"]["worktree"], "/retained/worktree");
}
