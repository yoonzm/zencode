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
 if(m==='model/list') {
  send({id:r.id,result:{data:[{id:p.cursor?'second':'first',model:p.cursor?'second':'first',supportedReasoningEfforts:[{reasoningEffort:'ultra',description:'Deep'}],defaultReasoningEffort:'ultra'}],nextCursor:p.cursor?null:'page2'}});
 }
 if(m==='thread/resume'||m==='thread/start') {
  if(p.developerInstructions.includes('只在当前任务工作区实现需求') || !p.developerInstructions.includes('访问、登录、部署并验证用户指定的测试环境')) throw Error('Workspace policy blocks remote verification');
    for (const rule of ['Playwright', 'headless: true', 'connectOverCDP', '禁止使用 Computer Use', 'unverified']) {
      if (!p.developerInstructions.includes(rule)) throw Error('Missing isolated headless browser policy: ' + rule);
    }
  send({id:r.id,result:{thread:{id:'fixture'}}});
 }
 if(m==='turn/start') {
  if(p.model !== 'fixture-model' || p.effort !== 'ultra') throw Error('Model/effort not forwarded');
  const id='turn-'+(++seq), prompt=p.input[0].text;
  require('node:fs').appendFileSync('prompts.log',JSON.stringify(prompt)+'\n');
  send({id:r.id,result:{turn:{id}}});
  if(require('node:fs').existsSync('live-diff.txt')) return;
  if(prompt.startsWith('live-diff-')) {
   require('node:fs').writeFileSync('live-diff.txt','visible before review\n');
   const type=prompt.split('\n')[0].slice('live-diff-'.length);
   if(type==='turn') send({method:'turn/completed',params:{turn:{id,status:'completed'}}});
   else send({method:'item/completed',params:{item:{id:'edit',type,command:'edit',exitCode:0}}});
   return;
  }
  if(prompt==='stop-fixture') return;
  if(prompt==='queue-fixture') { setTimeout(()=>send({method:'turn/completed',params:{turn:{id,status:'completed'}}}),500); return; }
  const plan=prompt.includes('不执行验证');
  const result={state:'passed',summary:'fixture report',steps:[{id:'1',title:'Check fixture',expect:'ok',status:plan?'pending':'passed',note:plan?'':'fixture evidence'}]};
  send({method:'item/completed',params:{item:{id:'msg-'+seq,type:'agentMessage',text:JSON.stringify(result)}}});
  send({method:'turn/completed',params:{turn:{id,status:'completed'}}});
 }
 if(m==='turn/interrupt') {
  send({id:r.id,result:{}});
  send({method:'turn/completed',params:{turn:{id:p.turnId,status:'interrupted'}}});
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
    let config = json!({"codex":{"cliPath":cli,"effort":"ultra","model":"fixture-model"},"mappings":[{"product":"P","repos":[{"repo":"team/app","branch":"main"}],"verify":{"enabled":true,"prompt":"Check fixture"}}]});
    (dir,rt,config)
}

#[tokio::test]
async fn diff_is_published_during_edits_and_before_verification() {
    for trigger in ["fileChange", "commandExecution", "turn"] {
        let (_dir, rt, config) = fixture().await;
        rt.call("start", json!({"id":"bug-1","config":config,"instruction":format!("live-diff-{trigger}")})).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let task = rt.data.lock().await["tasks"][0].clone();
                if task["run"]["rawDiff"].as_str().unwrap_or("").contains("+visible before review") {
                    assert_eq!(task["run"]["state"], "running");
                    if trigger != "turn" || task["run"]["verify"]["state"] == "planning" { break; }
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        }).await.expect("Changes must be visible while the turn or verification is still running");
        rt.shutdown().await;
    }
}

#[tokio::test]
async fn verification_plan_runs_automatically() {
    let (_dir, rt, config) = fixture().await;
    rt.call("start", json!({"id":"bug-1","config":config})).await.unwrap();
    assert_eq!(wait(&rt,"review").await["run"]["verify"]["state"], "passed");
    rt.shutdown().await;
}

#[tokio::test]
async fn disabled_verification_does_not_wait_for_plan() {
    let (_dir,rt,mut config) = fixture().await;
    config["mappings"][0]["verify"]["enabled"] = json!(false);
    rt.call("start",json!({"id":"bug-1","config":config})).await.unwrap();
    assert_eq!(wait(&rt,"review").await["run"]["verify"]["state"],"unverified");
    rt.shutdown().await;
}

#[tokio::test]
async fn queued_message_runs_in_next_turn() {
    let (dir,rt,mut config) = fixture().await;
    config["mappings"][0]["verify"]["enabled"] = json!(false);
    rt.call("start",json!({"id":"bug-1","config":config,"instruction":"queue-fixture"})).await.unwrap();
    wait(&rt,"running").await;
    rt.call("start",json!({"id":"bug-1","config":config,"instruction":"follow-up"})).await.unwrap();
    wait(&rt,"review").await;
    let prompts = std::fs::read_to_string(dir.path().join("repo/prompts.log")).unwrap();
    assert_eq!(prompts.lines().collect::<Vec<_>>(), vec!["\"queue-fixture\"", "\"follow-up\""]);
    assert_eq!(rt.data.lock().await["tasks"][0]["run"]["pendingInstructions"],json!([]));
    rt.shutdown().await;
}

#[tokio::test]
async fn workspace_paths_and_manual_diff_refresh() {
    let (dir,rt,_) = fixture().await;
    let repo = dir.path().join("repo");
    std::fs::write(repo.join("manual.txt"),"manual change\n").unwrap();
    std::fs::write(dir.path().join("outside.txt"),"outside\n").unwrap();
    assert!(rt.call("workdirTarget",json!({"id":"bug-1","file":"manual.txt"})).await.is_ok());
    assert!(rt.call("workdirTarget",json!({"id":"bug-1","file":"../outside.txt"})).await.is_err());
    rt.call("refreshDiff",json!({"id":"bug-1"})).await.unwrap();
    let task = rt.data.lock().await["tasks"][0].clone();
    assert_eq!(task["run"]["manualFiles"],json!(["manual.txt"]));
    assert!(task["run"]["rawDiff"].as_str().unwrap().contains("manual change"));
    rt.call("refreshDiff",json!({"id":"bug-1"})).await.unwrap();
    assert_eq!(rt.data.lock().await["tasks"][0]["run"]["manualFiles"],json!(["manual.txt"]));
}

#[tokio::test]
async fn stop_preserves_pending_message_for_continue() {
    let (dir,rt,mut config) = fixture().await;
    config["mappings"][0]["verify"]["enabled"] = json!(false);
    rt.call("start",json!({"id":"bug-1","config":config,"instruction":"stop-fixture"})).await.unwrap();
    wait(&rt,"running").await;
    rt.call("start",json!({"id":"bug-1","config":config,"instruction":"after-stop"})).await.unwrap();
    rt.call("pause",json!({"id":"bug-1"})).await.unwrap();
    let stopped = wait(&rt,"paused").await;
    assert_eq!(stopped["run"]["pendingInstructions"],json!(["after-stop"]));
    rt.shutdown().await;
    let resumed = Runtime::new(dir.path().join("data"),Arc::new(|_,_| {})).unwrap();
    resumed.call("start",json!({"id":"bug-1","config":config})).await.unwrap();
    wait(&resumed,"review").await;
    let prompts = std::fs::read_to_string(dir.path().join("repo/prompts.log")).unwrap();
    assert!(prompts.lines().any(|line| line == "\"after-stop\""));
    resumed.shutdown().await;
}

#[tokio::test]
async fn models_follow_all_catalog_pages() {
    let (_dir, rt, config) = fixture().await;
    let models = rt.call("codexModels", json!({"cliPath":config["codex"]["cliPath"]})).await.unwrap();
    assert_eq!(models.as_array().unwrap().len(), 2);
    assert_eq!(models[1]["model"], "second");
    assert_eq!(models[0]["supportedReasoningEfforts"][0]["reasoningEffort"], "ultra");
}
