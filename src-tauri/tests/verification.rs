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
let seq=0, interruptMode='';
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
  require('node:fs').appendFileSync('policies.log',JSON.stringify(p.developerInstructions)+'\n');
  send({id:r.id,result:{thread:{id:'fixture'}}});
 }
 if(m==='turn/start') {
  if(p.model !== 'fixture-model' || p.effort !== 'ultra') throw Error('Model/effort not forwarded');
  const id='turn-'+(++seq), prompt=p.input[0].text;
  require('node:fs').appendFileSync('prompts.log',JSON.stringify(prompt)+'\n');
  require('node:fs').appendFileSync('inputs.log',JSON.stringify(p.input)+'\n');
  send({id:r.id,result:{turn:{id}}});
  if(prompt.startsWith('interrupt-race-')) {
   interruptMode=prompt.split('\n')[0].slice('interrupt-race-'.length);
   send({method:'item/agentMessage/delta',params:{itemId:'ready',delta:'interrupt-ready'}});
   return;
  }
  if(require('node:fs').existsSync('live-diff.txt')) return;
  if(prompt.startsWith('live-diff-')) {
   require('node:fs').writeFileSync('live-diff.txt','visible before review\n');
   const type=prompt.split('\n')[0].slice('live-diff-'.length);
   if(type==='turn') send({method:'turn/completed',params:{turn:{id,status:'completed'}}});
   else send({method:'item/completed',params:{item:{id:'edit',type,command:'edit',exitCode:0}}});
   return;
  }
  if(prompt.split('\n')[0]==='stop-fixture') return;
  if(prompt.split('\n')[0]==='queue-fixture') { setTimeout(()=>send({method:'turn/completed',params:{turn:{id,status:'completed'}}}),500); return; }
  if(require('node:fs').readFileSync('policies.log','utf8').includes('context-usage-fixture')) {
   const tokenUsage={last:{totalTokens:seq===1?45000:seq===2?47000:12000},total:{totalTokens:950000},modelContextWindow:475000};
   send({method:'thread/tokenUsage/updated',params:{threadId:'fixture',turnId:id,tokenUsage}});
   send({method:'thread/tokenUsage/updated',params:{threadId:'other-thread',turnId:id,tokenUsage:{...tokenUsage,last:{totalTokens:999999}}}});
   send({method:'thread/tokenUsage/updated',params:{threadId:'fixture',turnId:id,tokenUsage:{...tokenUsage,last:{totalTokens:-1}}}});
  }
  const plan=prompt.includes('不执行验证');
  if(!plan && prompt.includes('实时验证进度：') && require('node:fs').readFileSync('policies.log','utf8').includes('live-progress-fixture')) {
   const fs=require('node:fs');
   const path=JSON.parse(prompt.match(/本轮专用进度文件为 (.+?)。/)[1]);
   fs.mkdirSync(require('node:path').dirname(path),{recursive:true});
   const snapshot=status=>({target:'http://127.0.0.1:9000/check',where:'local',summary:'live '+status,steps:[{id:'0',status,note:status==='passed'?'HTTP 200':'opening page'}]});
   fs.writeFileSync(path,JSON.stringify(snapshot('running')));
   const timer=setInterval(()=>{
    if(fs.existsSync('progress-advance'))fs.writeFileSync(path,JSON.stringify(snapshot('passed')));
    if(!fs.existsSync('progress-finish'))return;
    clearInterval(timer);
    const malformed=prompt.includes('missing-final');
    const result={state:'passed',summary:'final report',target:'http://127.0.0.1:9000/final',steps:[{id:'0',title:'Check fixture',expect:'ok',status:'passed',note:'HTTP 200'}]};
    send({method:'item/completed',params:{item:{id:'msg-'+seq,type:'agentMessage',text:malformed?'invalid final':JSON.stringify(result)}}});
    send({method:'turn/completed',params:{turn:{id,status:'completed'}}});
   },100);
   return;
  }
  if(plan && require('node:fs').readFileSync('policies.log','utf8').includes('no-extra-verification')) {
   send({method:'item/completed',params:{item:{id:'msg-'+seq,type:'agentMessage',text:JSON.stringify({state:'unverified',verificationRequired:false,summary:'Only documentation changed; no extra verification needed',steps:[]})}}});
   send({method:'turn/completed',params:{turn:{id,status:'completed'}}}); return;
  }
  const result={state:'passed',summary:'fixture report',steps:[{id:'1',title:'Check fixture',expect:'ok',status:plan?'pending':'passed',note:plan?'':'fixture evidence'}]};
  send({method:'item/completed',params:{item:{id:'msg-'+seq,type:'agentMessage',text:JSON.stringify(result)}}});
  send({method:'turn/completed',params:{turn:{id,status:'completed'}}});
 }
 if(m==='turn/interrupt') {
  if(interruptMode) {
   if(interruptMode==='completed') send({method:'turn/completed',params:{turn:{id:p.turnId,status:'completed'}}});
   send({id:r.id,error:{code:-32600,message:interruptMode==='error'?'fixture interrupt failure':'no active turn to interrupt'}});
   return;
  }
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
    run["branch"] = json!("main");
    run["mapping"] = json!({"repo":"team/app","branch":"main"});
    run["repositories"] = json!([{"mapping":run["mapping"],"worktree":repo,"base":base,"branch":"main","path":""}]);
    run["threadId"] = json!("fixture");
    let root = dir.path().join("data");
    Storage::new(&root).save(&json!({"prefs":{},"tasks":[{"id":"bug-1","product":"P","repoId":"team/app","run":run}]})).unwrap();
    let rt = Runtime::new(root, Arc::new(|_,_| {})).unwrap();
    let config = json!({"codex":{"cliPath":cli,"effort":"ultra","model":"fixture-model"},"mappings":[{"product":"P","repos":[{"repo":"team/app","branch":"main"}],"verify":{"enabled":true,"prompt":"Check fixture"}}]});
    (dir,rt,config)
}

#[tokio::test]
async fn pause_handles_completion_race_and_missing_completion_event() {
    for mode in ["completed", "missing", "error"] {
        let (_dir, rt, config) = fixture().await;
        rt.call("start", json!({"id":"bug-1","config":config,"instruction":format!("interrupt-race-{mode}")})).await.unwrap();
        let task = wait(&rt, "running").await;
        let repo = std::path::Path::new(task["run"]["worktree"].as_str().unwrap());
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while !rt.data.lock().await["tasks"][0]["run"]["events"].as_array().unwrap().iter().any(|e| e["text"] == "interrupt-ready") {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        }).await.unwrap();
        // Keep an actual edit and a queued follow-up to verify cancellation
        // preserves work without launching the next turn.
        std::fs::write(repo.join("retained.txt"), "keep this edit\n").unwrap();
        rt.call("start", json!({"id":"bug-1","config":config,"instruction":"must not start"})).await.unwrap();
        let result = rt.call("pause", json!({"id":"bug-1"})).await;
        if mode == "error" {
            assert_eq!(result.unwrap_err(), "fixture interrupt failure");
            rt.shutdown().await;
            wait(&rt, "paused").await;
            continue;
        }
        result.unwrap();
        let paused = wait(&rt, "paused").await;
        assert_eq!(std::fs::read_to_string(repo.join("retained.txt")).unwrap(), "keep this edit\n");
        assert!(paused["run"]["rawDiff"].as_str().unwrap().contains("+keep this edit"));
        assert_eq!(std::fs::read_to_string(repo.join("prompts.log")).unwrap().lines().count(), 1);
        assert!(!paused["run"]["events"].as_array().unwrap().iter().any(|e| e["kind"] == "error"));
        rt.shutdown().await;
    }
}

#[tokio::test]
async fn images_reach_codex_on_start_queue_resume_and_survive_restart() {
    let (_dir, rt, mut config) = fixture().await;
    config["mappings"][0]["verify"]["enabled"] = json!(false);
    let image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
    rt.call("start", json!({"id":"bug-1","config":config,"instruction":"queue-fixture","images":[image]})).await.unwrap();
    wait(&rt, "running").await;
    rt.call("start", json!({"id":"bug-1","config":config,"images":[image]})).await.unwrap();
    let task = wait(&rt, "review").await;
    let repo = std::path::Path::new(task["run"]["worktree"].as_str().unwrap());
    let inputs: Vec<Value> = std::fs::read_to_string(repo.join("inputs.log")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    assert_eq!(inputs.len(), 4);
    for input in &inputs[..2] { assert_eq!(input[1], json!({"type":"image","url":image})); }
    assert_eq!(inputs[1][0]["text"], ""); // Image-only follow-up is allowed.
    let events = task["run"]["events"].as_array().unwrap();
    assert_eq!(events.iter().filter(|e| e["kind"] == "user" && e["images"][0] == image).count(), 2);
    rt.shutdown().await;
    let root = _dir.path().join("data");
    let recovered = Runtime::new(root.clone(), Arc::new(|_,_| {})).unwrap();
    assert!(recovered.data.lock().await["tasks"][0]["run"]["events"].as_array().unwrap().iter().any(|e| e["images"][0] == image));
    // A queued attachment saved by an interrupted session must be forwarded on resume.
    let mut data = recovered.data.lock().await;
    data["tasks"][0]["history"] = json!([{"at":1,"who":"alice","text":"备注中的验收要求"}]);
    data["tasks"][0]["run"]["pendingInstructions"] = json!([{"text":"saved follow-up","images":[image]}]);
    Storage::new(&root).save(&data).unwrap();
    drop(data);
    recovered.call("start", json!({"id":"bug-1","config":config})).await.unwrap();
    wait(&recovered, "review").await;
    let inputs: Vec<Value> = std::fs::read_to_string(repo.join("inputs.log")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    let last = inputs.iter().rev().find(|input| input.as_array().unwrap().len() > 1).unwrap();
    assert_eq!(last[1]["url"], image);
    assert!(last[0]["text"].as_str().unwrap().contains("备注中的验收要求"));
    assert!(last[0]["text"].as_str().unwrap().contains("saved follow-up"));
    recovered.shutdown().await;
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
async fn legacy_disabled_switch_no_longer_blocks_verification() {
    let (_dir,rt,mut config) = fixture().await;
    config["mappings"][0]["verify"]["enabled"] = json!(false);
    rt.call("start",json!({"id":"bug-1","config":config})).await.unwrap();
    assert_eq!(wait(&rt,"review").await["run"]["verify"]["state"],"passed");
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
    let prompts: Vec<String> = prompts.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    assert!(prompts[0].starts_with("queue-fixture\n"));
    assert_eq!(prompts[1], "follow-up");
    assert_eq!(prompts.len(), 4);
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
    assert!(prompts.lines().any(|line| serde_json::from_str::<String>(line).unwrap().starts_with("after-stop\n")));
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

#[tokio::test]
async fn project_prompt_reaches_start_resume_and_verification_and_can_skip() {
    for (resume, prompt) in [(false, "project-development-rules"), (true, "no-extra-verification")] {
        let (dir, rt, mut config) = fixture().await;
        config["mappings"][0]["projectPrompt"] = json!(prompt);
        if !resume { rt.data.lock().await["tasks"][0]["run"]["threadId"] = json!(""); }
        rt.call("start", json!({"id":"bug-1","config":config})).await.unwrap();
        let task = wait(&rt,"review").await;
        assert_eq!(task["run"]["verify"]["state"], if resume { "unverified" } else { "passed" });
        let policies = std::fs::read_to_string(dir.path().join("repo/policies.log")).unwrap();
        assert!(policies.contains(prompt));
        assert!(!policies.contains("Check fixture"));
        let prompts: Vec<String> = std::fs::read_to_string(dir.path().join("repo/prompts.log")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(prompts.len(), if resume { 2 } else { 3 });
        assert!(prompts[1].contains(prompt));
        if !resume { assert!(prompts[2].contains(prompt)); }
        else { assert_eq!(task["run"]["verify"]["verificationRequired"], false); }
        rt.shutdown().await;
    }
}

#[tokio::test]
async fn empty_project_prompt_still_assesses_and_runs_verification() {
    let (_dir, rt, mut config) = fixture().await;
    config["mappings"][0]["projectPrompt"] = json!("");
    config["mappings"][0]["verify"]["enabled"] = json!(false);
    rt.call("start",json!({"id":"bug-1","config":config})).await.unwrap();
    wait(&rt,"review").await;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            match rt.call("reverify",json!({"id":"bug-1","config":config})).await {
                Ok(_) => break,
                Err(error) => assert!(error.contains("执行正在收尾"), "{error}"),
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }).await.unwrap();
    assert_eq!(wait(&rt,"review").await["run"]["verify"]["state"],"passed");
    rt.shutdown().await;
}

#[tokio::test]
async fn context_usage_updates_across_phases_and_survives_restart() {
    let (dir, rt, mut config)=fixture().await;
    config["mappings"][0]["projectPrompt"]=json!("context-usage-fixture");
    rt.call("start",json!({"id":"bug-1","config":config})).await.unwrap();
    let task=wait(&rt,"review").await;
    assert_eq!(task["run"]["contextUsage"],json!({"usedTokens":12000,"contextWindow":475000}));
    rt.shutdown().await;
    let restored=Runtime::new(dir.path().join("data"),Arc::new(|_,_| {})).unwrap();
    assert_eq!(restored.data.lock().await["tasks"][0]["run"]["contextUsage"],task["run"]["contextUsage"]);
    restored.shutdown().await;
}

#[tokio::test]
async fn progress_streams_while_turn_is_running_and_final_report_remains_authoritative() {
    for missing_final in [false,true] {
        let (dir,rt,mut config)=fixture().await;
        config["mappings"][0]["projectPrompt"]=json!(if missing_final {"live-progress-fixture missing-final"} else {"live-progress-fixture"});
        rt.call("start",json!({"id":"bug-1","config":config})).await.unwrap();
        for expected in ["running","passed"] {
            tokio::time::timeout(std::time::Duration::from_secs(15),async {
                loop {
                    let task=rt.data.lock().await["tasks"][0].clone();
                    assert_ne!(task["run"]["state"],"failed","{task}");
                    let verify=&task["run"]["verify"];
                    if verify["steps"][0]["status"]==expected {
                        assert_eq!(verify["state"],"running");
                        assert_eq!(task["run"]["state"],"running");
                        assert_eq!(verify["target"],"http://127.0.0.1:9000/check");
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
            }).await.unwrap();
            std::fs::write(dir.path().join("repo/progress-advance"),"").unwrap();
        }
        std::fs::write(dir.path().join("repo/progress-finish"),"").unwrap();
        let task=wait(&rt,"review").await;
        assert_eq!(task["run"]["verify"]["steps"][0]["status"],"passed");
        assert_eq!(task["run"]["verify"]["state"],if missing_final {"unverified"} else {"passed"});
        assert_eq!(task["run"]["verify"]["target"],if missing_final {"http://127.0.0.1:9000/check"} else {"http://127.0.0.1:9000/final"});
        rt.shutdown().await;
    }
}
