use serde_json::{json, Value};
use std::sync::Arc;
use zencode_core::{runtime::Runtime, services::{command, empty_run}, storage::Storage};

async fn wait(rt: &Arc<Runtime>, expected: &str) -> Value {
    for _ in 0..500 {
        let task = rt.data.lock().await["tasks"][0].clone();
        if task["run"]["state"] == expected { return task; }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("Expected {expected}: {}", rt.data.lock().await["tasks"]);
}

async fn fixture() -> (tempfile::TempDir, Arc<Runtime>, Value) {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    for args in [vec!["init", "-b", "main"], vec!["config", "user.email", "test@example.invalid"], vec!["config", "user.name", "Test"], vec!["commit", "--allow-empty", "-m", "initial"]] {
        command("git", &args, Some(&repo)).await.unwrap();
    }
    let base = command("git", &["rev-parse", "HEAD"], Some(&repo)).await.unwrap();
    let script = r#"#!/usr/bin/env node
const readline = require('node:readline');
const send = v => process.stdout.write(JSON.stringify(v)+'\n');
let seq=0;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line), m=r.method, p=r.params;
 if(m==='initialize') send({id:r.id,result:{}});
 if(m==='thread/resume'||m==='thread/start') send({id:r.id,result:{thread:{id:'fixture'}}});
 if(m==='turn/start') {
  const id='turn-'+(++seq), prompt=p.input[0].text;
  send({id:r.id,result:{turn:{id}}});
  const plan=prompt.includes('不执行验证');
  const result={state:'passed',summary:'fixture report',steps:[{id:'1',title:'Check fixture',expect:'ok',status:plan?'pending':'passed',note:plan?'':'fixture evidence'}]};
  send({method:'item/completed',params:{item:{id:'msg-'+seq,type:'agentMessage',text:JSON.stringify(result)}}});
  send({method:'turn/completed',params:{turn:{id,status:'completed'}}});
 }
});
"#;
    #[cfg(windows)]
    let cli = {
        let js = dir.path().join("node_modules/@openai/codex/bin/codex.js");
        std::fs::create_dir_all(js.parent().unwrap()).unwrap();
        std::fs::write(js, script).unwrap();
        let cli = dir.path().join("fixture.cmd");
        std::fs::write(&cli, "@echo off").unwrap();
        cli
    };
    #[cfg(unix)]
    let cli = {
        use std::os::unix::fs::PermissionsExt;
        let cli = dir.path().join("fixture");
        std::fs::write(&cli, script).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
        cli
    };
    let mut run = empty_run();
    run["worktree"] = json!(repo);
    run["base"] = json!(base);
    run["threadId"] = json!("fixture");
    let root = dir.path().join("data");
    Storage::new(&root).save(&json!({"prefs":{},"tasks":[{"id":"bug-1","product":"P","repoId":"team/app","run":run}]})).unwrap();
    let rt = Runtime::new(root, Arc::new(|_,_| {})).unwrap();
    let config = json!({"codex":{"cliPath":cli,"confirmPlan":true},"mappings":[{"product":"P","repos":[{"repo":"team/app","branch":"main"}],"verify":{"enabled":true,"prompt":"Check fixture"}}]});
    (dir,rt,config)
}

#[tokio::test]
async fn verification_plan_confirm_skip_stop_and_reverify() {
    for decision in ["confirm", "skip", "stop"] {
        let (_dir,rt,config) = fixture().await;
        rt.call("start",json!({"id":"bug-1","config":config})).await.unwrap();
        let task = wait(&rt,"waiting").await;
        assert_eq!(task["run"]["verify"]["state"],"awaiting-plan");
        assert_eq!(task["run"]["verify"]["steps"][0]["status"],"pending");
        assert!(rt.call("start",json!({"id":"bug-1","config":config,"instruction":"bypass"})).await.is_err());
        if decision == "stop" {
            rt.call("stop",json!({"id":"bug-1"})).await.unwrap();
            assert_eq!(wait(&rt,"failed").await["run"]["verify"]["state"],"unverified");
        } else {
            rt.call("verifyDecision",json!({"id":"bug-1","go":decision=="confirm"})).await.unwrap();
            assert_eq!(wait(&rt,"review").await["run"]["verify"]["state"],if decision=="confirm" {"passed"} else {"unverified"});
            // The worker closes its CLI before removing its job entry.
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            let mut auto = config.clone(); auto["codex"]["confirmPlan"]=json!(false);
            rt.call("reverify",json!({"id":"bug-1","config":auto})).await.unwrap();
            assert_eq!(wait(&rt,"review").await["run"]["verify"]["state"],"passed");
        }
        rt.shutdown().await;
    }
}

#[tokio::test]
async fn disabled_verification_does_not_wait_for_plan() {
    let (_dir,rt,mut config) = fixture().await;
    config["mappings"][0]["verify"]["enabled"] = json!(false);
    rt.call("start",json!({"id":"bug-1","config":config})).await.unwrap();
    assert_eq!(wait(&rt,"review").await["run"]["verify"]["state"],"unverified");
    rt.shutdown().await;
}
