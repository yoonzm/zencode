use super::*;

#[tokio::test]
async fn streaming_and_command_bursts_keep_output_without_per_event_scans() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    for args in [vec!["init", "-b", "main"], vec!["config", "user.email", "test@example.invalid"], vec!["config", "user.name", "Test"], vec!["commit", "--allow-empty", "-m", "base"]] {
        command("git", &args, Some(&repo)).await.unwrap();
    }
    let base = command("git", &["rev-parse", "HEAD"], Some(&repo)).await.unwrap();
    let script = r#"#!/usr/bin/env node
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');let turn=0;
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line),m=r.method;
 if(m==='initialize')send({id:r.id,result:{}});
 if(m==='thread/resume')send({id:r.id,result:{thread:{id:'test'}}});
 if(m==='turn/start'){
  const id='turn-'+(++turn);send({id:r.id,result:{turn:{id}}});
  if(r.params.input[0].text.includes('slow-scan-fixture')){
   send({method:'item/completed',params:{item:{id:'slow-read',type:'commandExecution',command:'read file',exitCode:0}}});
   setTimeout(()=>send({method:'item/agentMessage/delta',params:{itemId:'responsive',delta:'output while scan is waiting'}}),2500);
   return;
  }
  if(turn===1){
   for(let n=0;n<1000;n++)for(const itemId of ['a','b'])send({method:'item/agentMessage/delta',params:{itemId,delta:itemId}});
   require('node:fs').writeFileSync('kept.txt','kept edit\n');
   for(let n=0;n<50;n++)send({method:'item/completed',params:{item:{id:'cmd-'+n,type:'commandExecution',command:'read file',aggregatedOutput:'ok',exitCode:0}}});
  }else send({method:'item/completed',params:{item:{id:'final',type:'agentMessage',text:JSON.stringify({state:'unverified',verificationRequired:false,summary:'No extra checks',steps:[]})}}});
  send({method:'turn/completed',params:{turn:{id,status:'completed'}}});
 }
 if(m==='turn/interrupt'){
  send({id:r.id,result:{}});
  send({method:'turn/completed',params:{turn:{id:r.params.turnId,status:'interrupted'}}});
 }
});
"#;
    #[cfg(windows)]
    let cli = {
        let script_path = dir.path().join("node_modules/@openai/codex/bin/codex.js");
        std::fs::create_dir_all(script_path.parent().unwrap()).unwrap();
        std::fs::write(script_path, script).unwrap();
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
    let root = dir.path().join("data");
    let mut run = services::empty_run();
    run["worktree"] = json!(repo);
    run["threadId"] = json!("test");
    run["base"] = json!(base);
    run["repositories"] = json!([{"mapping":{"repo":"team/app","branch":"main"},"worktree":repo,"base":base,"branch":"main","path":""}]);
    Storage::new(&root).save(&json!({"tasks":[{"id":"a","product":"P","run":run}]})).unwrap();
    let updates = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let count = updates.clone();
    let rt = Runtime::new(root.clone(), Arc::new(move |name, _| { if name == "desktop:task" { count.fetch_add(1, Ordering::SeqCst); } })).unwrap();
    let config = json!({"codex":{"cliPath":cli},"mappings":[{"product":"P","repos":[{"repo":"team/app","branch":"main"}]}]});
    let started = std::time::Instant::now();
    rt.call("start", json!({"id":"a","config":config})).await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while !rt.jobs.lock().await.is_empty() { tokio::time::sleep(std::time::Duration::from_millis(20)).await; }
    }).await.unwrap();
    let task = rt.task("a").await.unwrap();
    assert_eq!(task["run"]["state"], "review", "{task}");
    let events = task["run"]["events"].as_array().unwrap();
    let messages: Vec<_> = events.iter().filter(|e| e["id"] == "message-a" || e["id"] == "message-b").collect();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["id"], "message-a");
    assert_eq!(messages[0]["text"], "a".repeat(1000));
    assert_eq!(messages[1]["text"], "b".repeat(1000));
    assert!(text(&task["run"], "rawDiff").contains("+kept edit"));
    assert!(updates.load(Ordering::SeqCst) < 150, "stream bursts should not emit 2000 full task snapshots");
    let scans = rt.diff_scans.load(Ordering::SeqCst);
    assert!(scans <= 10, "50 command events triggered {scans} full scans");
    let saved = Storage::new(&root).load().unwrap();
    assert_eq!(saved["tasks"][0]["run"]["events"], task["run"]["events"]);
    println!("2000 deltas + 50 commands: {} UI updates, {scans} scans, {:?}", updates.load(Ordering::SeqCst), started.elapsed());
    // A background scan waiting on another task must not block new messages.
    let scan = rt.diff_slots.acquire().await.unwrap();
    rt.call("start", json!({"id":"a","config":config,"instruction":"slow-scan-fixture"})).await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            let task = rt.task("a").await.unwrap();
            if task["run"]["events"].as_array().unwrap().iter().any(|e| e["id"] == "message-responsive") { break; }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }).await.expect("Git scan blocked streamed output");
    drop(scan);
    rt.call("pause", json!({"id":"a"})).await.unwrap();
    rt.shutdown().await;
    assert_eq!(rt.task("a").await.unwrap()["run"]["state"], "paused");
}

#[tokio::test]
async fn verification_waiters_share_capacity_and_cancel_without_starting_work() {
    let root = tempfile::tempdir().unwrap();
    Storage::new(root.path()).save(&json!({"tasks":[{"id":"a","run":services::empty_run()}]})).unwrap();
    let rt = Runtime::new(root.path().into(), Arc::new(|_, _| {})).unwrap();
    let held = rt.verification_slots.clone().acquire_owned().await.unwrap();
    let job = Arc::new(Job::new());
    rt.jobs.lock().await.insert("a".into(), job.clone());
    let cloned = rt.clone();
    let worker = job.clone();
    let waiting = tokio::spawn(async move { cloned.verification_permit("a", &worker).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while rt.task("a").await.unwrap()["run"]["activity"] != "等待验证资源" { tokio::task::yield_now().await; }
    }).await.unwrap();
    rt.call("pause", json!({"id":"a"})).await.unwrap();
    assert!(waiting.await.unwrap().is_err());
    rt.jobs.lock().await.remove("a");
    let args = json!({"mode":"trial","mapping":{"product":"P","repos":[{"repo":"team/app","branch":"main"}]}});
    let result = rt.call("verificationToolStart", args).await.unwrap();
    let id = result["id"].clone();
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let status = rt.call("verificationToolStatus", json!({"id":id})).await.unwrap();
            if status["message"] == "等待验证资源" { break; }
            tokio::task::yield_now().await;
        }
    }).await.unwrap();
    assert!(!root.path().join("verification-tools").exists(), "queued trials must not clone or start Codex");
    rt.call("verificationToolCancel", json!({"id":id})).await.unwrap();
    drop(held);
    rt.shutdown().await;
}

#[tokio::test]
async fn transient_output_checkpoints_do_not_write_for_each_flush() {
    let root = tempfile::tempdir().unwrap();
    Storage::new(root.path()).save(&json!({"tasks":[{"id":"a","run":services::empty_run()}]})).unwrap();
    let rt = Runtime::new(root.path().into(), Arc::new(|_, _| {})).unwrap();
    let before = rt.storage.reserve_revision();
    for _ in 0..100 { rt.flush_stream("a", &mut vec![("message-a".into(), "x".into())]).await.unwrap(); }
    assert_eq!(rt.storage.reserve_revision(), before + 1, "transient flushes must not save state");
    rt.persist().await.unwrap();
    assert_eq!(Storage::new(root.path()).load().unwrap()["tasks"][0]["run"]["events"][0]["text"], "x".repeat(100));
}
