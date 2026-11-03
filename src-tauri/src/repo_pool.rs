use super::*;
use std::path::Path;

impl Runtime {
    async fn repository_lock(&self, pool: &Path) -> Arc<Mutex<()>> {
        self.repository_locks.lock().await.entry(pool.to_path_buf()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
    }

    pub(super) async fn add_repository_worktree(&self, id: &str, repository: &str, remote: &str, target: &str, branch: &str, cwd: &Path, job: &Job) -> Result<String> {
        // Include the server in the identity; equal project paths on different hosts must not share data.
        let pool = self.root.join("repository-pool").join(crate::workspace::directory(&format!("{remote}#{repository}")));
        let lock = self.repository_lock(&pool).await;
        let _guard = loop {
            tokio::select! {
                guard = lock.lock() => break guard,
                _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {
                    if job.stopped.load(Ordering::SeqCst) || job.paused.load(Ordering::SeqCst) { return Err("执行已取消，工作区保留".into()); }
                }
            }
        };
        let cancel = Some((&job.stopped, &job.paused));
        if !pool.join("HEAD").exists() {
            std::fs::create_dir_all(&pool).map_err(|e|e.to_string())?;
            services::repository_command(&["init","--bare"],Some(&pool),cancel).await?;
        }
        #[cfg(windows)]
        services::repository_command(&["config","--local","core.longpaths","true"],Some(&pool),cancel).await?;
        if services::repository_command(&["remote","get-url","origin"],Some(&pool),cancel).await.is_err() {
            services::repository_command(&["remote","add","origin",remote],Some(&pool),cancel).await?;
        }
        let actual = services::repository_command(&["remote","get-url","origin"],Some(&pool),cancel).await?;
        if actual != remote { return Err("仓库池 origin 与配置不一致".into()); }
        let task = self.task(id).await?;
        let pending = &task["run"]["preparingRepository"];
        let base = if Path::new(text(pending,"worktree")) == cwd && pending["remote"] == remote && pending["branch"] == branch && !text(pending,"base").is_empty() {
            text(pending,"base").to_owned()
        } else {
            self.event(id,json!({"kind":"system","text":format!("正在更新仓库池目标分支：{target}（首次下载完整历史，后续增量更新）")})).await?;
            let reference = format!("refs/remotes/origin/{target}");
            let refspec = format!("+refs/heads/{target}:{reference}");
            services::repository_command(&["fetch","--no-tags","--progress","origin",&refspec],Some(&pool),cancel).await?;
            let base = services::repository_command(&["rev-parse","--verify",&format!("{reference}^{{commit}}")],Some(&pool),cancel).await?;
            self.update(id,|t|t["run"]["preparingRepository"] = json!({"worktree":cwd,"remote":remote,"branch":branch,"base":base})).await?;
            base
        };
        self.event(id,json!({"kind":"system","text":"正在从本地仓库池创建任务工作目录"})).await?;
        // The branch itself is also the recovery marker if checkout was interrupted before task metadata was saved.
        if let Ok(existing) = services::repository_command(&["rev-parse","--verify",&format!("refs/heads/{branch}")],Some(&pool),cancel).await {
            if existing != base { return Err("未完成初始化的任务分支已有额外提交，请检查工作目录".into()); }
            let listing = services::repository_command(&["worktree","list","--porcelain","-z"],Some(&pool),cancel).await?;
            if listing.split('\0').filter_map(|s|s.strip_prefix("worktree ")).any(|p|Path::new(p) == cwd) {
                if cwd.exists() && std::fs::read_dir(cwd).map_err(|e|e.to_string())?.next().is_some() {
                    return Err("中断的 worktree 目录仍有文件，已保留，请检查后重试".into());
                }
                services::repository_command(&["worktree","remove","--force",&cwd.to_string_lossy()],Some(&pool),cancel).await?;
            }
            services::repository_command(&["worktree","add",&cwd.to_string_lossy(),branch],Some(&pool),cancel).await?;
        } else {
            services::repository_command(&["worktree","add","--no-track","-b",branch,&cwd.to_string_lossy(),&base],Some(&pool),cancel).await?;
        }
        Ok(base)
    }

    pub(super) async fn complete_repository_checkout(&self, id: &str, cwd: &Path, base: &str, job: &Job) -> Result<()> {
        let cancel = Some((&job.stopped,&job.paused));
        let index = services::repository_command(&["rev-parse","--git-path","index"],Some(cwd),cancel).await?;
        let index = cwd.join(index);
        if index.exists() && self.task(id).await?["run"]["preparingRepository"]["restoringCheckout"] != true { return Ok(()); }
        // A failed initial checkout may leave files but no index. Rebuild its index and
        // fill only missing files; never overwrite files already edited by the user.
        self.update(id,|t|t["run"]["preparingRepository"]["restoringCheckout"]=json!(true)).await?;
        if !index.exists() { services::repository_command(&["read-tree",base],Some(cwd),cancel).await?; }
        let missing = services::repository_command(&["ls-files","--deleted","-z"],Some(cwd),cancel).await?;
        let paths = missing.split('\0').filter(|p|!p.is_empty()).collect::<Vec<_>>();
        for paths in paths.chunks(16) {
            let mut args = vec!["checkout-index","--"];
            args.extend_from_slice(paths);
            services::repository_command(&args,Some(cwd),cancel).await?;
        }
        Ok(())
    }

    // Deletion first stages the whole task directory transactionally. Repair only after the
    // state commit, so rollback/restart recovery still uses the original worktree paths.
    pub(super) async fn remove_repository_worktrees(&self, original: &Path, actual: &Path) -> Result<()> {
        let directory = self.root.join("repository-pool");
        if !directory.exists() { return Ok(()); }
        crate::cleanup::workspace(&self.root,&json!({"run":{"worktree":original}}))?;
        if !original.is_absolute() || original.parent() != Some(self.root.join("worktrees").as_path()) {
            return Err("拒绝注销应用工作目录以外的 worktree".into());
        }
        for entry in std::fs::read_dir(&directory).map_err(|e|e.to_string())? {
            let entry = entry.map_err(|e|e.to_string())?;
            let pool = entry.path();
            if !entry.file_type().map_err(|e|e.to_string())?.is_dir() { continue; }
            let lock = self.repository_lock(&pool).await;
            let _guard = lock.lock().await;
            let listing = services::repository_command(&["worktree","list","--porcelain","-z"],Some(&pool),None).await?;
            for field in listing.split('\0') {
                let Some(path) = field.strip_prefix("worktree ") else { continue; };
                let path = PathBuf::from(path);
                let relative = match path.strip_prefix(original).or_else(|_|path.strip_prefix(actual)) { Ok(relative) => relative, Err(_) => continue };
                let destination = actual.join(relative);
                let removal = if destination.join(".git").is_file() && original != actual {
                    services::repository_command(&["worktree","repair",&destination.to_string_lossy()],Some(&pool),None).await?;
                    destination
                } else { path };
                // Missing worktrees can be unregistered too; no unrelated entries are pruned.
                services::repository_command(&["worktree","remove","--force",&removal.to_string_lossy()],Some(&pool),None).await?;
            }
        }
        Ok(())
    }
}
