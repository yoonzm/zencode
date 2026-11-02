use serde_json::{json, Value};
use std::{path::Path, process::Stdio, sync::Arc};
use tokio::io::{AsyncBufReadExt, BufReader};
use zencode_core::{runtime::Runtime, services::{command, empty_run}, storage::Storage};

async fn review(rt: &Arc<Runtime>) -> Value {
    for _ in 0..1000 {
        let task=rt.data.lock().await["tasks"][0].clone();
        assert_ne!(task["run"]["state"],"failed","{task}");
        if task["run"]["state"]=="review" { return task; }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("Task did not reach review");
}

fn control(root: &Path, state: &str, reject: bool, branch: &str) {
    std::fs::write(root.join("control.json"),json!({"state":state,"rejectPush":reject,"branch":branch}).to_string()).unwrap();
}

#[tokio::test]
async fn submitted_task_resumes_and_pushes_revisions_to_same_mr_with_retry() {
    let dir=tempfile::tempdir().unwrap();
    let source=dir.path().join("source");std::fs::create_dir(&source).unwrap();
    for args in [vec!["init","-b","main"],vec!["config","user.email","test@example.invalid"],vec!["config","user.name","Test"]] { command("git",&args,Some(&source)).await.unwrap(); }
    std::fs::write(source.join("app.txt"),"initial\n").unwrap();
    command("git",&["add","."],Some(&source)).await.unwrap();
    command("git",&["commit","-m","initial"],Some(&source)).await.unwrap();
    let bare=dir.path().join("repo.git");
    command("git",&["clone","--bare",&source.to_string_lossy(),&bare.to_string_lossy()],None).await.unwrap();
    command("git",&["config","http.receivepack","true"],Some(&bare)).await.unwrap();
    control(dir.path(),"opened",false,"zencode/bug-7");
    let server_script=dir.path().join("server.cjs");
    std::fs::write(&server_script,include_str!("fixtures/mr-server.cjs")).unwrap();
    let mut server=tokio::process::Command::new("node").arg(server_script).arg(dir.path()).stdout(Stdio::piped()).kill_on_drop(true).spawn().unwrap();
    let mut port=String::new();BufReader::new(server.stdout.take().unwrap()).read_line(&mut port).await.unwrap();
    let url=format!("http://127.0.0.1:{}",port.trim());
    let data_root=dir.path().join("data");let worktree=data_root.join("worktrees/bug-7");
    std::fs::create_dir_all(worktree.parent().unwrap()).unwrap();
    command("git",&["clone",&format!("{url}/repo.git"),&worktree.to_string_lossy()],None).await.unwrap();
    for args in [vec!["config","user.email","test@example.invalid"],vec!["config","user.name","Test"],vec!["checkout","-b","zencode/bug-7"]] { command("git",&args,Some(&worktree)).await.unwrap(); }
    let base=command("git",&["rev-parse","HEAD"],Some(&worktree)).await.unwrap();
    let script=r#"const fs=require('node:fs');
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line),p=r.params;
 if(r.method==='initialize')send({id:r.id,result:{}});
 if(r.method==='thread/start'||r.method==='thread/resume'){
  fs.mkdirSync('.verification',{recursive:true});fs.appendFileSync('.verification/session.jsonl',JSON.stringify(r)+'\n');
  send({id:r.id,result:{thread:{id:'same-thread'}}});
 }
 if(r.method==='turn/start'){
  fs.appendFileSync('.verification/session.jsonl',JSON.stringify(r)+'\n');
  send({id:r.id,result:{turn:{id:'turn'}}});
  const plan=p.input[0].text.includes('不执行验证');
  if(!plan)fs.writeFileSync('app.txt',p.input[0].text.includes('first change')?'first revision\n':'second revision\n');
  const text=plan?JSON.stringify({state:'unverified',verificationRequired:false,summary:'No extra checks for fixture',steps:[]}):'Changed app.txt';
  send({method:'item/completed',params:{item:{id:'message',type:'agentMessage',text}}});
  send({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}});
 }
});"#;
    #[cfg(windows)]
    let cli={let js=dir.path().join("node_modules/@openai/codex/bin/codex.js");std::fs::create_dir_all(js.parent().unwrap()).unwrap();std::fs::write(js,script).unwrap();let cli=dir.path().join("fixture.cmd");std::fs::write(&cli,"").unwrap();cli};
    #[cfg(unix)]
    let cli={use std::os::unix::fs::PermissionsExt;let cli=dir.path().join("fixture");std::fs::write(&cli,format!("#!/usr/bin/env node\n{script}")).unwrap();std::fs::set_permissions(&cli,std::fs::Permissions::from_mode(0o700)).unwrap();cli};
    let mapping=json!({"repo":"team/app","branch":"main"});
    let mut run=empty_run();run["worktree"]=json!(worktree);run["base"]=json!(base);run["branch"]=json!("zencode/bug-7");run["mapping"]=mapping.clone();
    Storage::new(&data_root).save(&json!({"prefs":{},"tasks":[{"id":"bug-7","kind":"bug","no":7,"title":"Fix app","product":"P","repoId":"team/app","description":[],"run":run}]})).unwrap();
    let mut config=json!({"gitlab":{"baseUrl":url,"token":"fixture","mrMode":"manual","mrDraft":false},"codex":{"cliPath":cli},"mappings":[{"product":"P","repos":[mapping]}]});
    let rt=Runtime::new(data_root.clone(),Arc::new(|_,_|{})).unwrap();
    rt.call("start",json!({"id":"bug-7","config":config,"instruction":"first change"})).await.unwrap();
    review(&rt).await;
    rt.call("mr",json!({"id":"bug-7","config":config})).await.unwrap();
    let original=rt.data.lock().await["tasks"][0].clone();
    let first=command("git",&["rev-parse","refs/heads/zencode/bug-7"],Some(&bare)).await.unwrap();
    assert_eq!(original["run"]["mr"]["iid"],4);
    assert_eq!(original["run"]["state"],"done");
    rt.shutdown().await;
    let rt=Runtime::new(data_root.clone(),Arc::new(|_,_|{})).unwrap();
    // Existing tasks retain the original MR repository, branch, workspace and thread.
    config["mappings"][0]["repos"][0]=json!({"repo":"team/other","branch":"other-target"});
    let image="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
    rt.call("start",json!({"id":"bug-7","config":config,"instruction":"revise this MR","images":[image]})).await.unwrap();
    let revised=review(&rt).await;
    for field in ["worktree","branch","threadId","mapping","mr"] { assert_eq!(revised["run"][field],original["run"][field],"{field}"); }
    assert!(revised["run"]["rawDiff"].as_str().unwrap().contains("second revision"));
    std::fs::write(worktree.join("app.txt"),"external edit after review\n").unwrap();
    assert!(rt.call("mr",json!({"id":"bug-7","config":config})).await.unwrap_err().contains("工作区在审核后发生变化"));
    std::fs::write(worktree.join("app.txt"),"second revision\n").unwrap();
    rt.call("refreshDiff",json!({"id":"bug-7"})).await.unwrap();
    control(dir.path(),"closed",false,"zencode/bug-7");
    assert!(rt.call("mr",json!({"id":"bug-7","config":config})).await.unwrap_err().contains("已关闭"));
    assert_eq!(command("git",&["rev-parse","HEAD"],Some(&worktree)).await.unwrap(),first);
    control(dir.path(),"opened",true,"zencode/bug-7");
    assert!(rt.call("mr",json!({"id":"bug-7","config":config})).await.is_err());
    let committed=command("git",&["rev-parse","HEAD"],Some(&worktree)).await.unwrap();
    assert_ne!(first,committed);
    assert_eq!(rt.data.lock().await["tasks"][0]["run"]["mrBusy"],false);
    rt.shutdown().await;
    let rt=Runtime::new(data_root.clone(),Arc::new(|_,_|{})).unwrap();
    control(dir.path(),"opened",false,"zencode/bug-7");
    rt.call("mr",json!({"id":"bug-7","config":config})).await.unwrap();
    assert_eq!(command("git",&["rev-parse","refs/heads/zencode/bug-7"],Some(&bare)).await.unwrap(),committed);
    command("git",&["merge-base","--is-ancestor",&first,&committed],Some(&worktree)).await.unwrap();
    assert_eq!(rt.data.lock().await["tasks"][0]["run"]["mr"],original["run"]["mr"]);
    assert!(command("git",&["ls-tree","HEAD",".verification"],Some(&worktree)).await.unwrap().is_empty());
    // A follow-up with no new changes is idempotent and still reuses the MR.
    rt.call("start",json!({"id":"bug-7","config":config,"instruction":"explain without new changes"})).await.unwrap();
    review(&rt).await;
    rt.call("mr",json!({"id":"bug-7","config":config})).await.unwrap();
    assert_eq!(command("git",&["rev-parse","HEAD"],Some(&worktree)).await.unwrap(),committed);
    let records:Vec<Value>=std::fs::read_to_string(worktree.join(".verification/session.jsonl")).unwrap().lines().map(|s|serde_json::from_str(s).unwrap()).collect();
    assert!(records.iter().any(|r|r["method"]=="thread/resume"&&r["params"]["threadId"]=="same-thread"));
    assert!(records.iter().any(|r|r["params"]["input"][1]["type"]=="image"));
    let requests:Vec<Value>=std::fs::read_to_string(dir.path().join("api.jsonl")).unwrap().lines().map(|s|serde_json::from_str(s).unwrap()).collect();
    assert_eq!(requests.iter().filter(|r|r["method"]=="POST").count(),1,"Must create only one MR");
    for state in ["merged","closed"] {
        control(dir.path(),state,false,"zencode/bug-7");
        assert!(rt.call("start",json!({"id":"bug-7","config":config,"instruction":"do not run"})).await.is_err());
        assert_eq!(rt.data.lock().await["tasks"][0]["run"]["state"],"done");
    }
    control(dir.path(),"opened",false,"different-branch");
    assert!(rt.call("start",json!({"id":"bug-7","config":config,"instruction":"do not run"})).await.unwrap_err().contains("源分支"));
    control(dir.path(),"opened",false,"zencode/bug-7");
    command("git",&["checkout","-b","wrong-branch"],Some(&worktree)).await.unwrap();
    assert!(rt.call("start",json!({"id":"bug-7","config":config,"instruction":"do not run"})).await.unwrap_err().contains("工作区分支"));
    command("git",&["checkout","zencode/bug-7"],Some(&worktree)).await.unwrap();
    rt.data.lock().await["tasks"][0]["run"]["cleaned"]=json!(true);
    assert!(rt.call("start",json!({"id":"bug-7","config":config,"instruction":"do not run"})).await.unwrap_err().contains("工作区已清理"));
    rt.shutdown().await;
}
