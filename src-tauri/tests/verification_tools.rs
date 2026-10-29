use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio, sync::Arc};
use tokio::io::{AsyncBufReadExt, BufReader};
use zencode_core::{runtime::Runtime, services::command};

struct Fixture { _dir: tempfile::TempDir, _server: tokio::process::Child, root: PathBuf, rt: Arc<Runtime>, config: Value, mapping: Value }
async fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let repo=dir.path().join("source"); std::fs::create_dir(&repo).unwrap();
    for args in [vec!["init","-b","main"],vec!["config","user.email","test@example.invalid"],vec!["config","user.name","Test"]] { command("git",&args,Some(&repo)).await.unwrap(); }
    std::fs::write(repo.join("README.md"),"npm run verify-real-branch").unwrap();
    for args in [vec!["add","."],vec!["commit","-m","fixture"]] { command("git",&args,Some(&repo)).await.unwrap(); }
    let bare=dir.path().join("repo.git");
    command("git",&["clone","--bare",&repo.to_string_lossy(),&bare.to_string_lossy()],None).await.unwrap();
    let server_script=dir.path().join("server.cjs");
    std::fs::write(&server_script,include_str!("fixtures/verification-server.cjs")).unwrap();
    let mut server=tokio::process::Command::new("node").arg(&server_script).arg(dir.path()).stdout(Stdio::piped()).kill_on_drop(true).spawn().unwrap();
    let mut line=String::new(); BufReader::new(server.stdout.take().unwrap()).read_line(&mut line).await.unwrap();
    let port:u16=line.trim().parse().unwrap();
    #[cfg(windows)]
    let cli={
        let js=dir.path().join("node_modules/@openai/codex/bin/codex.js");
        std::fs::create_dir_all(js.parent().unwrap()).unwrap(); std::fs::write(js,include_str!("fixtures/verification-cli.cjs")).unwrap();
        let cli=dir.path().join("fixture.cmd"); std::fs::write(&cli,"").unwrap(); cli
    };
    #[cfg(unix)]
    let cli={
        use std::os::unix::fs::PermissionsExt;
        let cli=dir.path().join("fixture"); std::fs::write(&cli,format!("#!/usr/bin/env node\n{}",include_str!("fixtures/verification-cli.cjs"))).unwrap();
        std::fs::set_permissions(&cli,std::fs::Permissions::from_mode(0o700)).unwrap(); cli
    };
    let root=dir.path().join("data"); let rt=Runtime::new(root.clone(),Arc::new(|_,_|{})).unwrap();
    let config=json!({"gitlab":{"baseUrl":format!("http://127.0.0.1:{port}"),"token":"private-test-token"},"codex":{"cliPath":cli,"sandbox":"workspace-write","confirmPlan":true}});
    let mapping=json!({"product":"P","repos":[{"repo":"team/app","branch":"main"}],"verify":{"enabled":true,"prompt":"Verify the README command"}});
    Fixture{_dir:dir,_server:server,root,rt,config,mapping}
}
async fn start(f:&Fixture,mode:&str,mapping:&Value)->String {
    f.rt.call("verificationToolStart",json!({"mode":mode,"config":f.config,"mapping":mapping})).await.unwrap()["id"].as_str().unwrap().into()
}
async fn wait(f:&Fixture,id:&str,wanted:&str)->Value {
    for _ in 0..1000 {
        let s=f.rt.call("verificationToolStatus",json!({"id":id})).await.unwrap();
        if s["status"]==wanted || s["waiting"]["kind"]==wanted { return s; }
        assert_ne!(s["status"],"error","{s}");
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("Timed out waiting for {wanted}");
}
async fn decide(f:&Fixture,id:&str,s:&Value,go:bool) {
    f.rt.call("verificationToolDecide",json!({"id":id,"waitingId":s["waiting"]["id"],"go":go})).await.unwrap();
}
#[tokio::test]
async fn real_clone_draft_trial_approval_and_cleanup() {
    let f=fixture().await;
    let id=start(&f,"draft",&f.mapping).await;
    let s=wait(&f,&id,"done").await;
    assert!(s["result"]["prompt"].as_str().unwrap().contains("npm run verify-real-branch"));
    assert_eq!(s["sources"][0]["branch"],"main");
    assert!(!f.root.join("verification-tools").join(&id).exists());
    let id=start(&f,"trial",&f.mapping).await;
    let plan=wait(&f,&id,"plan").await;
    assert!(f.rt.prepare_update("9.9.9").await.is_err());
    assert!(f.rt.call("verificationToolDecide",json!({"id":id,"waitingId":"stale","go":true})).await.is_err());
    decide(&f,&id,&plan,true).await;
    let approval=wait(&f,&id,"approval").await;
    decide(&f,&id,&approval,true).await;
    let s=wait(&f,&id,"done").await;
    assert_eq!(s["result"]["verify"]["state"],"passed");
    assert!(s["logs"].as_array().unwrap().iter().any(|l|l["text"].as_str().unwrap().contains("Actual fixture output")));
    assert!(!f.root.join("verification-tools").join(&id).exists());
    assert!(f.rt.data.lock().await["tasks"].as_array().is_none_or(|a|a.is_empty()));
}
#[tokio::test]
async fn skipped_cancelled_failed_and_invalid_trials_never_pass() {
    let f=fixture().await;
    let id=start(&f,"trial",&f.mapping).await;
    let plan=wait(&f,&id,"plan").await; decide(&f,&id,&plan,false).await;
    assert_eq!(wait(&f,&id,"done").await["result"]["verify"]["state"],"unverified");
    let id=start(&f,"trial",&f.mapping).await;
    wait(&f,&id,"plan").await;
    f.rt.call("verificationToolCancel",json!({"id":id})).await.unwrap();
    let s=wait(&f,&id,"error").await; assert!(s["result"].is_null());
    assert!(!f.root.join("verification-tools").join(&id).exists());
    for (instruction,expected) in [("force-fail","failed"),("invalid-report","unverified")] {
        let mut mapping=f.mapping.clone(); mapping["verify"]["prompt"]=json!(instruction);
        let id=start(&f,"trial",&mapping).await;
        if instruction=="force-fail" {
            let plan=wait(&f,&id,"plan").await; decide(&f,&id,&plan,true).await;
            let approval=wait(&f,&id,"approval").await; decide(&f,&id,&approval,true).await;
        }
        assert_eq!(wait(&f,&id,"done").await["result"]["verify"]["state"],expected);
    }
    let mut mapping=f.mapping.clone(); mapping["repos"][0]["branch"]=json!("missing-branch");
    let id=start(&f,"draft",&mapping).await;
    assert!(wait(&f,&id,"error").await["result"].is_null());
}
