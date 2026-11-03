use super::*;

impl Runtime {
    pub(super) async fn prepare_workspace(&self, id: &str, config: &Value, mapping: &Value, job: &Arc<Job>) -> Result<()> {
        let mut task = self.task(id).await?;
        let mapping = if task["run"]["productMapping"].is_object() { task["run"]["productMapping"].clone() } else { mapping.clone() };
        let links = crate::workspace::links(&mapping)?;
        if text(&task["run"], "worktree").is_empty() {
            let suffix = format!("{}-{}-{}", text(&task,"kind"), task["no"].as_u64().unwrap_or(0), &Uuid::new_v4().to_string()[..8]);
            let root = self.root.join("worktrees").join(&suffix);
            std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            self.update(id, |t| {
                t["run"]["worktree"] = json!(root);
                t["run"]["branch"] = json!(format!("zencode/{suffix}"));
                t["run"]["repositories"] = json!([]);
                t["run"]["productMapping"] = mapping.clone();
            }).await?;
            task = self.task(id).await?;
        }
        let root = PathBuf::from(text(&task["run"], "worktree"));
        if !root.is_dir() { return Err("任务工作目录不存在，请恢复工作目录后重试".into()); }
        let mut repositories = crate::workspace::repositories(&task["run"]);
        for (index, link) in links.iter().enumerate() {
            if job.stopped.load(Ordering::SeqCst) || job.paused.load(Ordering::SeqCst) { return Err("执行已取消，工作区保留".into()); }
            if repositories.iter().any(|r| r["mapping"]["repo"] == link["repo"]) { continue; }
            self.event(id,json!({"kind":"system","text":format!("正在准备产品仓库 {}/{}：{}",index+1,links.len(),text(link,"repo"))})).await?;
            command("git", &["check-ref-format", "--branch", text(link, "branch")], None).await?;
            let api = services::gitlab(&config["gitlab"])?;
            let encoded = url::form_urlencoded::byte_serialize(text(link,"repo").as_bytes()).collect::<String>();
            let project = api.request(&format!("/projects/{encoded}"), "GET", None).await?;
            let remote = text(&project, "ssh_url_to_repo");
            let remote = if remote.is_empty() { text(&project, "http_url_to_repo") } else { remote };
            if remote.is_empty() || remote.starts_with('-') { return Err("GitLab 项目没有有效的克隆地址".into()); }
            let path = if links.len() == 1 && repositories.is_empty() { String::new() } else {
                format!(".zencode-repos/{}", crate::workspace::directory(text(link,"repo")))
            };
            let cwd = root.join(&path);
            std::fs::create_dir_all(cwd.parent().unwrap()).map_err(|e| e.to_string())?;
            let branch = text(&task["run"],"branch");
            let created_base = if !cwd.join(".git").exists() {
                Some(self.add_repository_worktree(id,text(link,"repo"),remote,text(link,"branch"),branch,&cwd,job).await?)
            } else { None };
            // Resume a worktree interrupted before its metadata was saved, without overwriting changes.
            if !cwd.join(".git").is_file() { return Err("任务仓库必须使用仓库池 worktree".into()); }
            let actual = command("git", &["remote","get-url","origin"],Some(&cwd)).await?;
            if actual != remote { return Err("未完成初始化的仓库 origin 与配置不一致".into()); }
            let current = command("git", &["symbolic-ref","--short","HEAD"],Some(&cwd)).await?;
            if current != branch { return Err("当前工作区分支与任务源分支不一致".into()); }
            let base = if let Some(base) = created_base { base } else {
                // Pool fetches by other tasks may have moved origin/<target> since this checkout.
                let pending = &task["run"]["preparingRepository"];
                if PathBuf::from(text(pending,"worktree")) != cwd || text(pending,"base").is_empty() {
                    return Err("未完成初始化的 worktree 缺少基线记录，请检查工作目录".into());
                }
                text(pending,"base").to_owned()
            };
            if command("git", &["rev-parse","HEAD"],Some(&cwd)).await? != base { return Err("未完成初始化的仓库已有额外提交，请先检查工作目录".into()); }
            repositories.push(json!({"mapping":link,"path":path,"worktree":cwd,"branch":branch,"base":base}));
            self.update(id, |t| {
                t["run"]["repositories"] = json!(repositories);
                t["run"]["mapping"] = repositories[0]["mapping"].clone();
                t["run"]["base"] = repositories[0]["base"].clone();
                t["run"]["productMapping"] = mapping.clone();
                t["run"]["preparingRepository"] = Value::Null;
            }).await?;
        }
        self.update(id, |t| {
            t["run"]["repositories"] = json!(repositories);
            t["run"]["productMapping"] = mapping;
        }).await?;
        Ok(())
    }

    pub(super) async fn save_repository(&self, id: &str, repo: &Value) -> Result<()> {
        self.update(id, |t| {
            let mut repositories = crate::workspace::repositories(&t["run"]);
            if let Some(entry) = repositories.iter_mut().find(|r| r["mapping"]["repo"] == repo["mapping"]["repo"]) { *entry = repo.clone(); }
            let mrs: Vec<_> = repositories.iter().filter(|r| !r["mr"].is_null())
                .map(|r| json!({"repo":r["mapping"]["repo"],"iid":r["mr"]["iid"],"url":r["mr"]["url"]})).collect();
            t["run"]["mrs"] = json!(mrs);
            t["run"]["mr"] = mrs.first().cloned().unwrap_or(Value::Null);
            t["run"]["repositories"] = json!(repositories);
        }).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn server(response: Arc<dyn Fn(&str) -> Value + Send + Sync>) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0;65536];
                let count = socket.read(&mut buffer).await.unwrap();
                let request = String::from_utf8_lossy(&buffer[..count]);
                let body = response(&request).to_string();
                let _ = socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await;
            }
        });
        (base,handle)
    }

    async fn repository(path: &std::path::Path, branch: &str) {
        std::fs::create_dir_all(path).unwrap();
        for args in [vec!["init","-b",branch],vec!["config","user.email","test@example.com"],vec!["config","user.name","Test"]] {
            command("git",&args,Some(path)).await.unwrap();
        }
        std::fs::write(path.join("same.txt"),"base\n").unwrap();
        command("git",&["add","."],Some(path)).await.unwrap();
        command("git",&["commit","-m","base"],Some(path)).await.unwrap();
    }

    #[tokio::test]
    async fn cancelling_fetch_closes_the_network_helper_connection() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let remote = format!("http://{}/slow.git",listener.local_addr().unwrap());
        let (connected,ready) = tokio::sync::oneshot::channel();
        let (closed,done) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket,_) = listener.accept().await.unwrap();
            let mut request = [0;4096];socket.read(&mut request).await.unwrap();
            let _ = connected.send(());
            let mut rest = Vec::new();let _ = socket.read_to_end(&mut rest).await;
            let _ = closed.send(());
        });
        let root = tempfile::tempdir().unwrap();
        command("git",&["init","--bare"],Some(root.path())).await.unwrap();
        let job = Arc::new(Job::new());let flag = job.clone();
        let cancel = tokio::spawn(async move { ready.await.unwrap();flag.paused.store(true,Ordering::SeqCst); });
        let result = tokio::time::timeout(std::time::Duration::from_secs(10),services::repository_command(&["fetch",&remote,"main"],Some(root.path()),Some((&job.stopped,&job.paused)))).await.unwrap();
        assert!(result.unwrap_err().contains("执行已取消"));
        tokio::time::timeout(std::time::Duration::from_secs(3),done).await.unwrap().unwrap();
        cancel.await.unwrap();server.await.unwrap();
    }

    #[tokio::test]
    async fn one_workspace_clones_all_branches_resumes_and_aggregates_distinct_file_paths() {
        let source = tempfile::tempdir().unwrap();
        let front = source.path().join("front"); let api = source.path().join("api");
        repository(&front,"main").await; repository(&api,"dev").await;
        let front_remote = front.to_string_lossy().to_string(); let api_remote = api.to_string_lossy().to_string();
        let (base,server) = server(Arc::new(move |request| {
            assert!(request.starts_with("GET /api/v4/projects/"));
            json!({"ssh_url_to_repo":if request.contains("team%2Ffront") { &front_remote } else { &api_remote }})
        })).await;
        let root = tempfile::tempdir().unwrap();
        Storage::new(root.path()).save(&json!({"tasks":[{"id":"story-7","kind":"story","no":7,"product":"P","run":services::empty_run()}]})).unwrap();
        let runtime = Runtime::new(root.path().into(),Arc::new(|_,_|{})).unwrap();
        let mapping = json!({"product":"P","repos":[{"repo":"team/front","branch":"main"},{"repo":"team/api","branch":"dev"}]});
        let config = json!({"gitlab":{"baseUrl":base,"token":"fixture"}});
        runtime.prepare_workspace("story-7",&config,&mapping,&Arc::new(Job::new())).await.unwrap();
        let task = runtime.task("story-7").await.unwrap();
        let entries = crate::workspace::repositories(&task["run"]);
        assert_eq!(entries.len(),2);
        assert_eq!(runtime.data.lock().await["tasks"].as_array().unwrap().len(),1);
        assert_ne!(entries[0]["worktree"],entries[1]["worktree"]);
        for repo in &entries {
            let cwd = PathBuf::from(text(repo,"worktree"));
            assert!(cwd.join(".git").is_file());
            std::fs::write(cwd.join("same.txt"),"changed\n").unwrap();
            std::fs::create_dir_all(cwd.join(".verification")).unwrap();
            std::fs::write(cwd.join(".verification/secret.txt"),"evidence").unwrap();
        }
        let diff = runtime.diff("story-7").await.unwrap();
        for repo in &entries { assert!(diff.contains(&format!("+++ b/{}/same.txt",text(repo,"path")))); }
        assert!(!diff.contains("secret.txt"));
        let path = runtime.call("workdirTarget",json!({"id":"story-7","repo":"team/api"})).await.unwrap();
        assert!(text(&entries[1],"worktree").replace('\\',"/").ends_with(&path.as_str().unwrap().replace('\\',"/")));
        let editor = runtime.call("workdirTarget",json!({"id":"story-7","editor":true})).await.unwrap();
        let workspace: Value = serde_json::from_slice(&std::fs::read(editor.as_str().unwrap()).unwrap()).unwrap();
        assert_eq!(workspace["folders"].as_array().unwrap().len(),2);
        assert_eq!(workspace["folders"][1]["name"],"team/api");
        runtime.prepare_workspace("story-7",&config,&mapping,&Arc::new(Job::new())).await.unwrap();
        assert_eq!(runtime.diff("story-7").await.unwrap(),diff);
        let prompt = task_prompt(&task,&mapping,"",false);
        assert!(prompt.contains("team/front")); assert!(prompt.contains("team/api"));
        // Single task deletion owns and removes all nested clones together.
        runtime.call("delete",json!({"id":"story-7"})).await.unwrap();
        assert!(runtime.data.lock().await["tasks"].as_array().unwrap().is_empty());
        server.abort();
    }

    #[tokio::test]
    async fn pool_shares_history_isolates_tasks_updates_incrementally_and_cleans_only_selected_worktree() {
        let source = tempfile::tempdir().unwrap();
        repository(source.path(),"main").await;
        let remote = source.path().to_string_lossy().to_string();
        let (base,server) = server(Arc::new(move |_|json!({"ssh_url_to_repo":remote}))).await;
        let root = tempfile::tempdir().unwrap();
        Storage::new(root.path()).save(&json!({"tasks":[
            {"id":"a","kind":"story","no":1,"run":services::empty_run()},
            {"id":"b","kind":"story","no":2,"run":services::empty_run()},
            {"id":"c","kind":"story","no":3,"run":services::empty_run()}
        ]})).unwrap();
        let runtime = Runtime::new(root.path().into(),Arc::new(|_,_|{})).unwrap();
        let mapping = json!({"product":"P","repos":[{"repo":"team/front","branch":"main"}]});
        let config = json!({"gitlab":{"baseUrl":base,"token":"fixture"}});
        let a_job = Arc::new(Job::new()); let b_job = Arc::new(Job::new());
        let (a,b) = tokio::join!(runtime.prepare_workspace("a",&config,&mapping,&a_job),runtime.prepare_workspace("b",&config,&mapping,&b_job));
        a.unwrap(); b.unwrap();
        assert_eq!(std::fs::read_dir(root.path().join("repository-pool")).unwrap().count(),1);
        let a = runtime.task("a").await.unwrap(); let b = runtime.task("b").await.unwrap();
        let a_path = PathBuf::from(text(&a["run"],"worktree")); let b_path = PathBuf::from(text(&b["run"],"worktree"));
        assert!(a_path.join(".git").is_file()); assert!(b_path.join(".git").is_file());
        let common = command("git",&["rev-parse","--git-common-dir"],Some(&a_path)).await.unwrap();
        assert_eq!(common,command("git",&["rev-parse","--git-common-dir"],Some(&b_path)).await.unwrap());
        assert!(runtime.remove_repository_worktrees(std::path::Path::new(""),&a_path).await.is_err());
        assert!(a_path.join(".git").is_file()); assert!(b_path.join(".git").is_file());
        std::fs::write(a_path.join("same.txt"),"task A\n").unwrap();
        assert_eq!(std::fs::read_to_string(b_path.join("same.txt")).unwrap().replace("\r\n","\n"),"base\n");
        command("git",&["-c","user.name=Test","-c","user.email=test@example.com","commit","-am","task A"],Some(&a_path)).await.unwrap();
        let original_base = b["run"]["base"].clone();
        assert_eq!(command("git",&["rev-parse","HEAD"],Some(&b_path)).await.unwrap(),original_base.as_str().unwrap());
        std::fs::write(source.path().join("same.txt"),"updated upstream\n").unwrap();
        command("git",&["commit","-am","upstream update"],Some(source.path())).await.unwrap();
        runtime.prepare_workspace("c",&config,&mapping,&Arc::new(Job::new())).await.unwrap();
        let c = runtime.task("c").await.unwrap(); let c_path = PathBuf::from(text(&c["run"],"worktree"));
        assert_ne!(c["run"]["base"],original_base);
        assert_eq!(std::fs::read_to_string(c_path.join("same.txt")).unwrap().replace("\r\n","\n"),"updated upstream\n");
        runtime.prepare_workspace("b",&config,&mapping,&b_job).await.unwrap();
        assert_eq!(runtime.task("b").await.unwrap()["run"]["base"],original_base);
        runtime.update("a",|t|t["run"]["state"]=json!("done")).await.unwrap();
        runtime.call("cleanup",json!({"mode":"done"})).await.unwrap();
        assert!(!a_path.exists());
        command("git",&["fsck","--no-reflogs"],Some(&b_path)).await.unwrap();
        assert_eq!(std::fs::read_to_string(b_path.join("same.txt")).unwrap().replace("\r\n","\n"),"base\n");
        runtime.call("delete",json!({"id":"b"})).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(10),async {
            loop {
                if runtime.data.lock().await["pendingDeletes"].as_array().is_some_and(|r|r.is_empty()) { break; }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        }).await.unwrap();
        let listing = command("git",&["worktree","list","--porcelain"],Some(&c_path)).await.unwrap();
        assert!(!listing.contains(&a_path.to_string_lossy().replace('\\',"/")));
        assert!(!listing.contains(&b_path.to_string_lossy().replace('\\',"/")));
        command("git",&["fsck","--no-reflogs"],Some(&c_path)).await.unwrap();
        server.abort();
    }

    #[tokio::test]
    async fn interrupted_initialization_resumes_original_sha_and_preserves_edits() {
        let source = tempfile::tempdir().unwrap(); repository(source.path(),"main").await;
        let remote = source.path().to_string_lossy().to_string(); let origin = remote.clone();
        let (base,server) = server(Arc::new(move |_|json!({"ssh_url_to_repo":remote}))).await;
        let root = tempfile::tempdir().unwrap();
        Storage::new(root.path()).save(&json!({"tasks":[{"id":"a","kind":"story","no":1,"run":services::empty_run()}]})).unwrap();
        let runtime = Runtime::new(root.path().into(),Arc::new(|_,_|{})).unwrap();
        let mapping = json!({"repo":"team/front","branch":"main"});
        let config = json!({"gitlab":{"baseUrl":base,"token":"fixture"}});
        let job = Arc::new(Job::new());
        runtime.prepare_workspace("a",&config,&mapping,&job).await.unwrap();
        let task = runtime.task("a").await.unwrap(); let cwd = PathBuf::from(text(&task["run"],"worktree"));
        let original = text(&task["run"],"base").to_owned();
        runtime.update("a",|t| {
            t["run"]["repositories"]=json!([]);
            t["run"]["preparingRepository"]=json!({"worktree":cwd,"remote":origin,"branch":task["run"]["branch"],"base":original});
        }).await.unwrap();
        std::fs::write(cwd.join("same.txt"),"preserved edit\n").unwrap();
        runtime.prepare_workspace("a",&config,&mapping,&job).await.unwrap();
        assert_eq!(runtime.task("a").await.unwrap()["run"]["base"],original);
        assert_eq!(std::fs::read_to_string(cwd.join("same.txt")).unwrap(),"preserved edit\n");
        server.abort();
    }

    #[tokio::test]
    async fn submits_all_existing_repository_mrs_and_completes_only_after_all_merge() {
        let root = tempfile::tempdir().unwrap();
        let mut repositories = Vec::new();
        let mut heads = Vec::new();
        for (name, branch, iid) in [("front","main",11),("api","dev",22)] {
            let cwd = root.path().join(name);
            repository(&cwd,branch).await;
            let head = command("git",&["rev-parse","HEAD"],Some(&cwd)).await.unwrap();
            heads.push(head.clone());
            command("git",&["remote","add","origin",&format!("https://gitlab.invalid/team/{name}.git")],Some(&cwd)).await.unwrap();
            repositories.push(json!({"mapping":{"repo":format!("team/{name}"),"branch":branch},"worktree":cwd,"path":name,"branch":branch,"base":head,"mr":{"iid":iid,"url":format!("https://gitlab.invalid/team/{name}/-/merge_requests/{iid}")}}));
        }
        let allow_second = Arc::new(AtomicBool::new(false));
        let flag = allow_second.clone();
        let (base,server) = server(Arc::new(move |request| {
            let second = request.contains("team%2Fapi");
            if request.contains("/merge_requests/") {
                if request.starts_with("PUT ") { return json!({"state":if !second || flag.load(Ordering::SeqCst) {"merged"} else {"opened"}}); }
                return json!({"state":"opened","source_branch":if second {"dev"} else {"main"},"sha":heads[if second {1} else {0}]});
            }
            json!({"http_url_to_repo":format!("https://gitlab.invalid/team/{}.git",if second {"api"} else {"front"})})
        })).await;
        let data_root = tempfile::tempdir().unwrap();
        let mut run = services::empty_run();
        run["state"] = json!("review"); run["worktree"] = json!(root.path()); run["repositories"] = json!(repositories);
        Storage::new(data_root.path()).save(&json!({"tasks":[{"id":"story-7","kind":"story","no":7,"title":"Task","run":run}]})).unwrap();
        let runtime = Runtime::new(data_root.path().into(),Arc::new(|_,_|{})).unwrap();
        let config = json!({"gitlab":{"baseUrl":base,"token":"fixture"}});
        runtime.create_mr("story-7",&config).await.unwrap();
        let task = runtime.task("story-7").await.unwrap();
        assert_eq!(task["run"]["state"],"done");
        assert_eq!(task["run"]["mrs"].as_array().unwrap().len(),2);
        assert!(runtime.merge_mr("story-7",&config).await.is_err());
        assert_eq!(runtime.task("story-7").await.unwrap()["run"]["state"],"done");
        allow_second.store(true,Ordering::SeqCst);
        runtime.merge_mr("story-7",&config).await.unwrap();
        assert_eq!(runtime.task("story-7").await.unwrap()["run"]["state"],"completed");
        server.abort();
    }

}
