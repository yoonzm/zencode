use crate::{Result,text,now,codex::Session,services::{self,command},storage::{Storage,store_secrets,restore_secrets}};
use serde_json::{json,Value};
use std::{collections::HashMap,path::PathBuf,sync::{Arc,atomic::{AtomicBool,Ordering}}};
use tokio::sync::{Mutex,Semaphore};
use uuid::Uuid;
pub type Emit=Arc<dyn Fn(&str,Value)+Send+Sync>;
struct Job{session:Mutex<Option<Arc<Session>>>,turn:Mutex<String>,approvals:Mutex<HashMap<String,Value>>,stopped:AtomicBool,paused:AtomicBool}
impl Job{fn new()->Self{Self{session:Mutex::new(None),turn:Mutex::new(String::new()),approvals:Mutex::new(HashMap::new()),stopped:AtomicBool::new(false),paused:AtomicBool::new(false)}}}
pub struct Runtime{root:PathBuf,pub data:Mutex<Value>,storage:Storage,emit:Emit,jobs:Mutex<HashMap<String,Arc<Job>>>,slots:Arc<Semaphore>,syncing:AtomicBool}
impl Runtime{
 pub fn new(root:PathBuf,emit:Emit)->Result<Arc<Self>>{
  let storage=Storage::new(&root);let mut data=storage.load()?;
  if let Some(tasks)=data["tasks"].as_array_mut(){for t in tasks{t["run"]["mrBusy"]=json!(false);if ["running","queued","paused","waiting"].contains(&text(&t["run"],"state")){t["run"]["state"]=json!("failed");push_event(t,json!({"kind":"error","text":"上次执行被应用退出中断，工作区已保留，可重试恢复会话。"}));}}}
  let limit=data["prefs"]["config"]["codex"]["concurrency"].as_u64().unwrap_or(1).clamp(1,5) as usize;
  Ok(Arc::new(Self{root,data:Mutex::new(data),storage,emit,jobs:Mutex::new(HashMap::new()),slots:Arc::new(Semaphore::new(limit)),syncing:AtomicBool::new(false)}))
 }
 async fn persist(&self)->Result<()>{let data=self.data.lock().await;self.storage.save(&data)}
 async fn update<F>(&self,id:&str,f:F)->Result<()>where F:FnOnce(&mut Value){
  let task={let mut data=self.data.lock().await;let t=data["tasks"].as_array_mut().and_then(|ts|ts.iter_mut().find(|t|text(t,"id")==id)).ok_or("任务不存在")?;f(t);t["updatedAt"]=json!(now());t.clone()};
  (self.emit)("desktop:task",task);self.persist().await
 }
 async fn task(&self,id:&str)->Result<Value>{self.data.lock().await["tasks"].as_array().and_then(|ts|ts.iter().find(|t|text(t,"id")==id)).cloned().ok_or("任务不存在".into())}
 async fn event(&self,id:&str,ev:Value)->Result<()>{self.update(id,|t|{push_event(t,ev);}).await}
 pub async fn call(self:&Arc<Self>,op:&str,args:Value)->Result<Value>{
  match op{
   "load"=>{let mut data=self.data.lock().await.clone();data["prefs"]=restore_secrets(&data["prefs"])?;Ok(data)}
   "save"=>{let clean=store_secrets(&args)?;let old=self.data.lock().await["prefs"]["config"]["codex"]["concurrency"].as_u64().unwrap_or(1).clamp(1,5);let new=args["config"]["codex"]["concurrency"].as_u64().unwrap_or(1).clamp(1,5);if new>old{self.slots.add_permits((new-old)as usize);}else if new<old{let sem=self.slots.clone();tokio::spawn(async move{if let Ok(permits)=sem.acquire_many_owned((old-new)as u32).await{permits.forget();}});}self.data.lock().await["prefs"]=clean;self.persist().await?;Ok(Value::Null)}
   "products"=>Ok(self.data.lock().await["products"].clone()),
   "test"=>{let c=&args["config"];match text(&args,"kind"){
    "codex"=>{let file=if text(c,"cliPath").is_empty(){"codex"}else{text(c,"cliPath")};let version=command(file,&["--version"],None).await?;let(session,_)=Session::spawn(file,&self.root).await?;let result=async{session.initialize().await?;session.request("account/read",json!({"refreshToken":false})).await}.await;session.close().await;let account=result?;if account["account"].is_null(){return Err("Codex 尚未登录，请在终端运行 codex login".into());}Ok(json!(format!("{version} · app-server 可连接，已检测登录账号；模型执行将在任务中验证")))}
    "gitlab"=>{let u=services::gitlab(c)?.request("/user","GET",None).await?;Ok(json!(format!("已连接 · @{}（项目写权限在提交时验证）",text(&u,"username"))))}
    _=>{let api=services::zentao(c).await?;let rows=api.pages("/products","products").await?;self.data.lock().await["products"]=json!(rows.iter().map(|r|text(r,"name")).collect::<Vec<_>>());self.persist().await?;Ok(json!(format!("已连接 · 可见 {} 个产品",rows.len())))}}
   }
   "sync"=>{if self.syncing.swap(true,Ordering::SeqCst){return Err("正在同步".into());}let result=services::sync(&args["config"]).await;self.syncing.store(false,Ordering::SeqCst);let(mut tasks,products)=result?;{let mut data=self.data.lock().await;let old=data["tasks"].as_array().cloned().unwrap_or_default();for t in &mut tasks{if let Some(previous)=old.iter().find(|p|p["id"]==t["id"]){t["run"]=previous["run"].clone();t["history"]=previous["history"].clone();}}for previous in old{if text(&previous["run"],"state")!="idle"&&!tasks.iter().any(|t|t["id"]==previous["id"]){tasks.push(previous);}}data["tasks"]=json!(tasks);data["products"]=json!(products);}self.persist().await?;Ok(json!(tasks))}
   "start"=>{self.enqueue(text(&args,"id"),args["config"].clone(),text(&args,"instruction").to_owned()).await?;Ok(Value::Null)}
   "pause"|"stop"=>{let id=text(&args,"id");let job=self.jobs.lock().await.get(id).cloned().ok_or("没有活动执行")?;job.stopped.store(op=="stop",Ordering::SeqCst);job.paused.store(op=="pause",Ordering::SeqCst);if let Some(session)=job.session.lock().await.clone(){let turn=job.turn.lock().await.clone();if !turn.is_empty(){let task=self.task(id).await?;session.request("turn/interrupt",json!({"threadId":task["run"]["threadId"],"turnId":turn})).await?;}else{session.close().await;}}Ok(Value::Null)}
   "approve"=>{let id=text(&args,"id");let job=self.jobs.lock().await.get(id).cloned().ok_or("审批已失效")?;let ev=text(&args,"evId");let decision=match text(&args,"decision"){"once"=>"accept","always"=>"acceptForSession","deny"=>"decline",_=>return Err("无效审批决定".into())};let rpc=job.approvals.lock().await.remove(ev).ok_or("审批已失效")?;let session=job.session.lock().await.clone().ok_or("Codex 会话已关闭")?;session.send(json!({"id":rpc,"result":{"decision":decision}})).await?;let waiting=!job.approvals.lock().await.is_empty();self.update(id,|t|{if let Some(es)=t["run"]["events"].as_array_mut(){if let Some(e)=es.iter_mut().find(|e|text(e,"id")==ev){e["decision"]=args["decision"].clone();}}t["run"]["state"]=json!(if waiting{"waiting"}else{"running"});}).await?;Ok(Value::Null)}
   "viewed"=>{self.update(text(&args,"id"),|t|t["run"]["viewed"]=args["paths"].clone()).await?;Ok(Value::Null)}
   "mr"=>{self.create_mr(text(&args,"id"),&args["config"]).await?;Ok(Value::Null)}
   _=>Err("不支持的操作".into())
  }
 }
 async fn enqueue(self:&Arc<Self>,id:&str,config:Value,instruction:String)->Result<()>{
  let t=self.task(id).await?;
  if let Some(job)=self.jobs.lock().await.get(id).cloned(){
   let session=job.session.lock().await.clone().ok_or("任务正在排队或启动，请稍后追加指令")?;let turn=job.turn.lock().await.clone();
   session.request("turn/steer",json!({"threadId":t["run"]["threadId"],"expectedTurnId":turn,"input":[{"type":"text","text":instruction,"text_elements":[]}]})).await?;self.event(id,json!({"kind":"user","text":instruction})).await?;return Ok(());
  }
  if !t["run"]["mr"].is_null(){return Err("已提交 MR 的任务不能重复执行".into());}
  let mapping=config["mappings"].as_array().and_then(|ms|ms.iter().find(|m|m["product"]==t["product"])).cloned().ok_or("请先配置此产品的仓库映射")?;
  let job=Arc::new(Job::new());self.jobs.lock().await.insert(id.into(),job.clone());
  self.update(id,|t|{t["run"]["state"]=json!("queued");t["run"]["startedAt"]=json!(now());t["run"]["finishedAt"]=Value::Null;t["run"]["model"]=config["codex"]["model"].clone();if !instruction.is_empty(){push_event(t,json!({"kind":"user","text":instruction}));}}).await?;
  let rt=self.clone();let id=id.to_owned();
  tokio::spawn(async move{
   let _permit=rt.slots.clone().acquire_owned().await;
   let result=rt.execute(&id,&config,&mapping,&instruction,&job).await;
   if let Some(session)=job.session.lock().await.take(){session.close().await;}
   if let Err(e)=result{let paused=job.paused.load(Ordering::SeqCst);let _=rt.update(&id,|t|{t["run"]["state"]=json!(if paused{"paused"}else{"failed"});push_event(t,json!({"kind":if paused{"system"}else{"error"},"text":e}));}).await;}
   let _=rt.update(&id,|t|t["run"]["finishedAt"]=json!(now())).await;rt.jobs.lock().await.remove(&id);
  });Ok(())
 }
 async fn execute(&self,id:&str,config:&Value,mapping:&Value,instruction:&str,job:&Arc<Job>)->Result<()>{
  if job.stopped.load(Ordering::SeqCst)||job.paused.load(Ordering::SeqCst){return Err("执行已取消，工作区保留".into());}
  self.update(id,|t|t["run"]["state"]=json!("running")).await?;
  let mut t=self.task(id).await?;
  if text(&t["run"],"worktree").is_empty(){
   let repo=services::local_path(text(mapping,"localPath"));command("git",&["rev-parse","--show-toplevel"],Some(&repo)).await?;command("git",&["check-ref-format","--branch",text(mapping,"branch")],Some(&repo)).await?;
   let suffix=format!("{}-{}",id,&Uuid::new_v4().to_string()[..8]);let branch=format!("zencode/{suffix}");let worktree=self.root.join("worktrees").join(&suffix);std::fs::create_dir_all(worktree.parent().unwrap()).map_err(|e|e.to_string())?;
   command("git",&["worktree","add","-b",&branch,&worktree.to_string_lossy(),text(mapping,"branch")],Some(&repo)).await?;
   let base=command("git",&["rev-parse","HEAD"],Some(&worktree)).await?;
   self.update(id,|t|{t["run"]["worktree"]=json!(worktree);t["run"]["branch"]=json!(branch);t["run"]["base"]=json!(base);t["run"]["repo"]=json!(repo);t["run"]["mapping"]=mapping.clone();}).await?;t=self.task(id).await?;
  }
  let cwd=PathBuf::from(text(&t["run"],"worktree"));let(session,mut messages)=Session::spawn(text(&config["codex"],"cliPath"),&cwd).await?;*job.session.lock().await=Some(session.clone());
  session.initialize().await?;
  let sandbox=match text(&config["codex"],"sandbox"){"read-only"=>"read-only","full-access"=>"danger-full-access",_=>"workspace-write"};let policy=if text(&config["codex"],"sandbox")=="workspace-write"{"on-request"}else{"never"};
  let mut params=json!({"cwd":cwd,"sandbox":sandbox,"approvalPolicy":policy,"approvalsReviewer":"user"});let resume=!text(&t["run"],"threadId").is_empty();if resume{params["threadId"]=t["run"]["threadId"].clone();}
  let response=session.request(if resume{"thread/resume"}else{"thread/start"},params).await?;let thread=response["thread"]["id"].clone();self.update(id,|t|t["run"]["threadId"]=thread.clone()).await?;
  let prompt=if resume{if instruction.is_empty(){"继续完成任务，保留已有改动并运行适当测试。".into()}else{instruction.into()}}else{format!("完成禅道 {} #{}: {}\n{}\n用户要求：{}\n保持现有 UI，禁止提交、推送或创建 MR。{}",text(&t,"kind"),t["no"],text(&t,"title"),t["description"],instruction,if text(mapping,"testCmd").is_empty(){"执行项目适当测试并报告真实结果。".to_owned()}else{format!("完成后运行测试：{}",text(mapping,"testCmd"))})};
  let effort=match text(&config["codex"],"model"){"Codex · 高推理"=>"high","Codex · 快速"=>"low",_=>"medium"};
  let turn=session.request("turn/start",json!({"threadId":thread,"effort":effort,"input":[{"type":"text","text":prompt,"text_elements":[]}]})).await?;*job.turn.lock().await=text(&turn["turn"],"id").into();
  if job.stopped.load(Ordering::SeqCst)||job.paused.load(Ordering::SeqCst){session.request("turn/interrupt",json!({"threadId":thread,"turnId":turn["turn"]["id"]})).await?;}
  while let Some(m)=messages.recv().await{
   let method=text(&m,"method");let p=&m["params"];
   if m.get("id").is_some(){
    if ["item/commandExecution/requestApproval","item/fileChange/requestApproval"].contains(&method){let event=Uuid::new_v4().to_string();job.approvals.lock().await.insert(event.clone(),m["id"].clone());self.update(id,|t|{push_event(t,json!({"id":event,"kind":"approval","cmd":p["command"].as_str().unwrap_or("文件修改请求"),"reason":p["reason"].as_str().unwrap_or("Codex 请求权限")}));t["run"]["state"]=json!("waiting");}).await?;}
    else{session.send(json!({"id":m["id"],"error":{"code":-32601,"message":"ZenCode 暂不支持此交互请求"}})).await?;self.event(id,json!({"kind":"error","text":format!("未支持的 Codex 交互：{method}")})).await?;}
    continue;
   }
   match method{
    "turn/completed"=>{if text(&p["turn"],"status")!="completed"{return Err(p["turn"]["error"]["message"].as_str().unwrap_or("执行已中断，工作区保留").into());}break;}
    "item/agentMessage/delta"=>{let event=format!("message-{}",text(p,"itemId"));self.update(id,|t|{let es=t["run"]["events"].as_array_mut().unwrap();if let Some(e)=es.iter_mut().find(|e|text(e,"id")==event){e["text"]=json!(format!("{}{}",text(e,"text"),text(p,"delta")));}else{push_event(t,json!({"id":event,"kind":"message","text":p["delta"]}));}}).await?;}
    "item/completed"=>{let i=&p["item"];if text(i,"type")=="commandExecution"{self.event(id,json!({"kind":"command","cmd":i["command"],"output":i["aggregatedOutput"],"exit":i["exitCode"].as_i64().unwrap_or(-1),"ms":i["durationMs"].as_u64().unwrap_or(0)})).await?;}else if text(i,"type")=="agentMessage"{let event=format!("message-{}",text(i,"id"));self.update(id,|t|{if !t["run"]["events"].as_array().unwrap().iter().any(|e|text(e,"id")==event){push_event(t,json!({"id":event,"kind":"message","text":i["text"]}));}}).await?;}}
    "turn/plan/updated"=>{let steps=p["plan"].as_array().map(|ps|ps.iter().map(|p|json!({"text":p["step"],"done":text(p,"status")=="completed"})).collect::<Vec<_>>()).unwrap_or_default();self.event(id,json!({"kind":"plan","title":p["explanation"].as_str().unwrap_or("执行计划"),"steps":steps})).await?;}
    "zencode/closed"|"zencode/protocolError"=>return Err("Codex 连接意外关闭或返回无效协议".into()),
    _=>{}
   }
  }
  self.diff(id).await?;self.update(id,|t|{t["run"]["state"]=json!("review");t["run"]["unread"]=json!(true);}).await
 }
 async fn diff(&self,id:&str)->Result<String>{let t=self.task(id).await?;let cwd=PathBuf::from(text(&t["run"],"worktree"));command("git",&["add","-N","--","."],Some(&cwd)).await?;let diff=command("git",&["-c","core.quotepath=false","diff","--no-ext-diff","--no-color",text(&t["run"],"base"),"--"],Some(&cwd)).await?;self.update(id,|t|t["run"]["rawDiff"]=json!(diff)).await?;Ok(diff)}
 async fn create_mr(&self,id:&str,config:&Value)->Result<()>{
  {let mut data=self.data.lock().await;let t=data["tasks"].as_array_mut().and_then(|ts|ts.iter_mut().find(|t|text(t,"id")==id)).ok_or("任务不存在")?;if text(&t["run"],"state")!="review"||t["run"]["mrBusy"].as_bool()==Some(true){return Err("任务不在待审核状态".into());}t["run"]["mrBusy"]=json!(true);}
  self.update(id,|_|{}).await?;
  let result=self.submit(id,config).await;self.update(id,|t|t["run"]["mrBusy"]=json!(false)).await?;result
 }
 async fn submit(&self,id:&str,config:&Value)->Result<()>{
  let t=self.task(id).await?;let run=&t["run"];let m=&run["mapping"];let cwd=PathBuf::from(text(run,"worktree"));let api=services::gitlab(&config["gitlab"])?;
  let encoded=url::form_urlencoded::byte_serialize(text(m,"repo").as_bytes()).collect::<String>();let project=api.request(&format!("/projects/{encoded}"),"GET",None).await?;
  let remote=command("git",&["remote","get-url","origin"],Some(&cwd)).await?;validate_remote(&remote,text(&config["gitlab"],"baseUrl"),text(&project,"path_with_namespace"))?;
  if run["mr"].is_null(){
   let diff=self.diff(id).await?;if diff.is_empty(){return Err("没有可提交的代码变更".into());}
   command("git",&["add","--all"],Some(&cwd)).await?;
   if !command("git",&["diff","--cached","--name-only"],Some(&cwd)).await?.is_empty(){command("git",&["commit","-m",&format!("{} #{}: {}",text(&t,"kind"),t["no"],text(&t,"title"))],Some(&cwd)).await?;}
   command("git",&["push","origin",&format!("HEAD:refs/heads/{}",text(run,"branch"))],Some(&cwd)).await?;
   let route=format!("/projects/{}/merge_requests",project["id"]);let branch=url::form_urlencoded::byte_serialize(text(run,"branch").as_bytes()).collect::<String>();let existing=api.request(&format!("{route}?state=opened&source_branch={branch}"),"GET",None).await?;
   let mr=if let Some(mr)=existing.as_array().and_then(|ms|ms.first()){mr.clone()}else{api.request(&route,"POST",Some(json!({"source_branch":run["branch"],"target_branch":m["branch"],"title":format!("{}{}",if config["gitlab"]["mrDraft"].as_bool()==Some(true){"Draft: "}else{""},text(&t,"title")),"description":format!("{} #{}\n{}",text(&t,"kind"),t["no"],text(&config["zentao"],"baseUrl"))}))).await?};
   self.update(id,|t|t["run"]["mr"]=json!({"iid":mr["iid"],"url":mr["web_url"]})).await?;
  }
  let t=self.task(id).await?;let zt=services::zentao(&config["zentao"]).await?;
  zt.request(&format!("/{}/{}",if text(&t,"kind")=="bug"{"bugs"}else{"stories"},t["no"]),"PUT",Some(json!({"comment":format!("ZenCode MR: {}",text(&t["run"]["mr"],"url"))}))).await?;
  self.update(id,|t|{t["run"]["state"]=json!("done");push_event(t,json!({"kind":"system","tone":"success","text":"已创建 MR 并回写链接。禅道状态未自动变更，请按团队工作流审核。"}));}).await
 }
 pub async fn shutdown(&self){for job in self.jobs.lock().await.values(){if let Some(session)=job.session.lock().await.as_ref(){session.close().await;}}}
}
fn push_event(t:&mut Value,mut ev:Value){if ev["id"].is_null(){ev["id"]=json!(Uuid::new_v4().to_string());}ev["at"]=json!(now());if let Some(es)=t["run"]["events"].as_array_mut(){es.push(ev);}}
pub fn validate_remote(remote:&str,base:&str,project:&str)->Result<()>{
 let normalized=if let Some(rest)=remote.strip_prefix("git@"){rest.replacen(':',"/",1)}else{remote.to_owned()};let normalized=if remote.starts_with("git@"){format!("https://{normalized}")}else{normalized};let u=url::Url::parse(&normalized).map_err(|_|"无法识别 origin URL")?;let expected=url::Url::parse(base).map_err(|_|"无效 GitLab 地址")?;
 if u.host_str()!=expected.host_str()||u.path().trim_start_matches('/').trim_end_matches(".git")!=project{return Err("本地 origin 与 GitLab 项目不一致，拒绝推送".into());}Ok(())
}
#[cfg(test)]mod tests{use super::*;#[test]fn reject_wrong_remote(){assert!(validate_remote("git@company.test:team/app.git","https://company.test","team/app").is_ok());assert!(validate_remote("https://evil.test/team/app.git","https://company.test","team/app").is_err());assert!(validate_remote("https://company.test/team/other.git","https://company.test","team/app").is_err());}}
