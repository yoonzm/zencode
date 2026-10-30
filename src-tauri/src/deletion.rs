use super::*;
use std::{path::Path, time::Instant};

// Only UUID-named, direct, non-redirected children of the application's trash are eligible.
fn trash_path(root: &Path, key: &str) -> Result<PathBuf> {
    Uuid::parse_str(key).map_err(|_| "Invalid deletion record")?;
    let parent = root.join("pending-delete");
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    if parent.canonicalize().map_err(|e| e.to_string())? != root.canonicalize().map_err(|e| e.to_string())?.join("pending-delete") {
        return Err("拒绝清理重定向的待清理目录".into());
    }
    let path = parent.join(key);
    match std::fs::symlink_metadata(&path) {
        Ok(meta) => {
            let linked = meta.file_type().is_symlink();
            #[cfg(windows)]
            let linked = { use std::os::windows::fs::MetadataExt; linked || meta.file_attributes() & 0x400 != 0 };
            if linked || !meta.is_dir() || path.canonicalize().map_err(|e| e.to_string())?.parent() != Some(parent.canonicalize().map_err(|e| e.to_string())?.as_path()) {
                return Err("拒绝清理链接或非独立待清理目录".into());
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(root: &Path, emit: Emit) -> Arc<Runtime> {
        let source = root.join("worktrees/task-1");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("keep.txt"), "local edits").unwrap();
        Storage::new(root).save(&json!({"prefs":{},"tasks":[{"id":"bug-1","run":{"state":"review","worktree":source}}]})).unwrap();
        Runtime::new(root.into(), emit).unwrap()
    }

    #[tokio::test]
    async fn removal_commits_before_cleanup_and_restarts_resume_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let stages = Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = stages.clone();
        let rt = fixture(root.path(), Arc::new(move |event, value| {
            if event == "desktop:delete" { captured.lock().unwrap().push(value); }
        }));
        // Pause the cleaner to prove the UI operation does not wait for physical deletion.
        rt.delete_cleaner_started.store(true, Ordering::SeqCst);
        let result = rt.call("delete", json!({"id":"bug-1"})).await.unwrap();
        assert_eq!(result["cleanupPending"], true);
        assert!(rt.task("bug-1").await.is_err());
        assert!(!root.path().join("worktrees/task-1").exists());
        let record = rt.data.lock().await["pendingDeletes"][0].clone();
        let trash = trash_path(root.path(), text(&record, "key")).unwrap();
        assert_eq!(std::fs::read_to_string(trash.join("keep.txt")).unwrap(), "local edits");
        assert_eq!(record["ready"], true);
        assert_eq!(stages.lock().unwrap().last().unwrap()["stage"], "removed");
        drop(rt);
        let restored = Runtime::new(root.path().into(), Arc::new(|_, _| {})).unwrap();
        restored.call("load", json!({})).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while !restored.data.lock().await["pendingDeletes"].as_array().unwrap().is_empty() {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        assert!(!trash.exists());
    }

    #[tokio::test]
    async fn interrupted_move_is_rolled_back_on_restart() {
        let root = tempfile::tempdir().unwrap();
        let rt = fixture(root.path(), Arc::new(|_, _| {}));
        let key = Uuid::new_v4().to_string();
        let source = root.path().join("worktrees/task-1");
        let destination = trash_path(root.path(), &key).unwrap();
        let mut data = rt.data.lock().await.clone();
        data["tasks"][0]["run"]["deleting"] = json!(true);
        data["pendingDeletes"] = json!([{"key":key,"source":source,"taskId":"bug-1","ready":false}]);
        Storage::new(root.path()).save(&data).unwrap();
        std::fs::rename(&source, &destination).unwrap();
        drop(rt);
        let restored = Runtime::new(root.path().into(), Arc::new(|_, _| {})).unwrap();
        assert_eq!(std::fs::read_to_string(source.join("keep.txt")).unwrap(), "local edits");
        assert_eq!(restored.task("bug-1").await.unwrap()["run"]["deleting"], false);
        assert!(restored.data.lock().await["pendingDeletes"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn failed_state_commit_restores_workspace_and_keeps_task() {
        let root = tempfile::tempdir().unwrap();
        let temp = root.path().join("state.tmp");
        let block_write = temp.clone();
        let rt = fixture(root.path(), Arc::new(move |event, value| {
            if event == "desktop:delete" && value["stage"] == "saving" {
                std::fs::create_dir(&block_write).unwrap();
            }
        }));
        assert!(rt.call("delete", json!({"id":"bug-1"})).await.is_err());
        assert!(rt.task("bug-1").await.is_ok());
        assert_eq!(std::fs::read_to_string(root.path().join("worktrees/task-1/keep.txt")).unwrap(), "local edits");
        assert_eq!(rt.data.lock().await["pendingDeletes"][0]["ready"], false);
        std::fs::remove_dir(temp).unwrap();
        assert!(rt.call("start", json!({"id":"bug-1"})).await.is_err());
        let restored = Runtime::new(root.path().into(), Arc::new(|_, _| {})).unwrap();
        assert!(restored.task("bug-1").await.is_ok());
        assert!(restored.data.lock().await["pendingDeletes"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn stopping_releases_global_lock_but_rejects_duplicate_and_same_task_start() {
        let root = tempfile::tempdir().unwrap();
        let stopping = Arc::new(Notify::new());
        let event = stopping.clone();
        let rt = fixture(root.path(), Arc::new(move |_, value| { if value["stage"] == "stopping" { event.notify_one(); } }));
        let job = Arc::new(Job::new());
        rt.jobs.lock().await.insert("bug-1".into(), job.clone());
        let cloned = rt.clone();
        let deleting = tokio::spawn(async move { cloned.call("delete", json!({"id":"bug-1"})).await });
        stopping.notified().await;
        let guard = tokio::time::timeout(std::time::Duration::from_millis(200), rt.task_mutations.lock()).await.unwrap();
        drop(guard);
        assert!(rt.call("delete", json!({"id":"bug-1"})).await.is_err());
        assert!(rt.call("start", json!({"id":"bug-1"})).await.is_err());
        assert!(rt.prepare_update("test").await.is_err());
        assert!(root.path().join("worktrees/task-1/keep.txt").exists());
        rt.jobs.lock().await.remove("bug-1");
        job.finished.notify_one();
        deleting.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn invalid_cleanup_record_never_removes_external_data() {
        let root = tempfile::tempdir().unwrap();
        let rt = fixture(root.path(), Arc::new(|_, _| {}));
        rt.data.lock().await["pendingDeletes"] = json!([{"key":"../worktrees/task-1","ready":true}]);
        rt.clean_deleted_files().await;
        assert!(root.path().join("worktrees/task-1/keep.txt").exists());
        assert!(rt.data.lock().await["pendingDeletes"][0]["lastError"].is_string());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn locked_file_cleanup_is_retained_and_retried() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = tempfile::tempdir().unwrap();
        let rt = fixture(root.path(), Arc::new(|_, _| {}));
        rt.delete_cleaner_started.store(true, Ordering::SeqCst);
        rt.call("delete", json!({"id":"bug-1"})).await.unwrap();
        let record = rt.data.lock().await["pendingDeletes"][0].clone();
        let trash = trash_path(root.path(), text(&record, "key")).unwrap();
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(trash.join("keep.txt")).unwrap();
        rt.clean_deleted_files().await;
        assert_eq!(rt.data.lock().await["pendingDeletes"][0]["attempts"], 1);
        assert!(rt.task("bug-1").await.is_err());
        drop(held);
        rt.clean_deleted_files().await;
        assert!(!trash.exists());
        assert!(rt.data.lock().await["pendingDeletes"].as_array().unwrap().is_empty());
    }
}

// A crash before the state commit must preserve the task and restore its workspace.
pub(super) fn recover(root: &Path, data: &mut Value) -> Result<()> {
    let records = data["pendingDeletes"].as_array().cloned().unwrap_or_default();
    for record in records.iter().filter(|r| r["ready"] != true) {
        let trash = trash_path(root, text(record, "key"))?;
        let source = PathBuf::from(text(record, "source"));
        crate::cleanup::workspace(root, &json!({"run":{"worktree":source}}))?;
        if trash.exists() {
            if source.exists() { return Err("删除恢复冲突：原目录和待清理目录同时存在，文件均已保留".into()); }
            std::fs::rename(&trash, &source).map_err(|e| format!("恢复未完成删除的工作目录失败：{e}"))?;
        }
    }
    data["pendingDeletes"] = json!(records.into_iter().filter(|r| r["ready"] == true).collect::<Vec<_>>());
    for task in data["tasks"].as_array_mut().into_iter().flatten() { task["run"]["deleting"] = json!(false); }
    Ok(())
}

impl Runtime {
    fn delete_progress(&self, id: &str, stage: &str, message: &str, started: Instant) {
        let elapsed = started.elapsed().as_millis();
        eprintln!("delete task={id} stage={stage} elapsedMs={elapsed}");
        (self.emit)("desktop:delete", json!({"id":id,"stage":stage,"message":message,"elapsedMs":elapsed}));
    }

    pub(super) async fn delete_task(self: &Arc<Self>, id: &str) -> Result<Value> {
        let started = Instant::now();
        self.delete_progress(id, "waiting", "正在等待其他操作完成…", started);
        {
            let _guard = self.task_mutations.lock().await;
            if self.updating.load(Ordering::SeqCst) { return Err("正在安装更新，请稍后再试".into()); }
            let task = self.task(id).await?;
            if self.data.lock().await["pendingDeletes"].as_array().is_some_and(|rs| rs.iter().any(|r| text(r, "taskId") == id && r["ready"] != true)) {
                return Err("上次删除尚待恢复，请重启应用恢复工作目录后重试".into());
            }
            if task["run"]["deleting"] == true { return Err("任务正在删除，请勿重复操作".into()); }
            self.deletion_workspace(&task).await?;
            if let Err(error) = self.update(id, |t| t["run"]["deleting"] = json!(true)).await {
                let _ = self.update(id, |t| t["run"]["deleting"] = json!(false)).await;
                return Err(error);
            }
        }
        let result = self.finish_delete(id, started).await;
        if result.is_err() {
            let _ = self.update(id, |t| t["run"]["deleting"] = json!(false)).await;
        }
        result
    }

    async fn finish_delete(self: &Arc<Self>, id: &str, started: Instant) -> Result<Value> {
        self.delete_progress(id, "stopping", "正在停止任务及其子进程…", started);
        let job = self.jobs.lock().await.get(id).cloned();
        if let Some(job) = job {
            job.stopped.store(true, Ordering::SeqCst);
            job.cancel_queue.notify_one();
            job.verify_ready.notify_one();
            // Do not keep the session mutex locked while the worker is closing it too.
            let session = job.session.lock().await.clone();
            tokio::time::timeout(std::time::Duration::from_secs(35), async {
                if let Some(session) = session { session.close().await; }
                job.finished.notified().await;
            }).await.map_err(|_| "执行仍在停止中，任务尚未删除，请稍后重试".to_string())?;
        }
        self.delete_progress(id, "waiting-commit", "正在准备移除任务…", started);
        let _guard = self.task_mutations.lock().await;
        let current = self.task(id).await?;
        let source = self.deletion_workspace(&current).await?;
        let mut record = Value::Null;
        let mut destination = None;
        if let Some(ref source) = source {
            let key = Uuid::new_v4().to_string();
            let path = trash_path(&self.root, &key)?;
            record = json!({"key":key,"taskId":id,"source":source,"ready":false});
            let mut data = self.data.lock().await;
            let mut next = data.clone();
            if !next["pendingDeletes"].is_array() { next["pendingDeletes"] = json!([]); }
            next["pendingDeletes"].as_array_mut().unwrap().push(record.clone());
            self.storage.save(&next)?;
            *data = next;
            destination = Some(path);
        }
        self.delete_progress(id, "moving", "正在将工作目录移入后台清理区…", started);
        if let (Some(source), Some(destination)) = (&source, &destination) {
            if let Err(e) = std::fs::rename(source, destination) {
                self.remove_delete_record(text(&record, "key")).await?;
                return Err(format!("无法移走工作目录，任务已保留，请关闭占用文件的程序后重试：{e}"));
            }
        }
        self.delete_progress(id, "saving", "正在保存删除结果…", started);
        let saved = {
            let mut data = self.data.lock().await;
            let mut next = data.clone();
            next["tasks"].as_array_mut().ok_or("任务数据无效")?.retain(|t| text(t, "id") != id);
            if let Some(markers) = next["cleanupMarkers"].as_array_mut() { markers.retain(|m| !crate::cleanup::same(m, &current)); }
            if let Some(records) = next["pendingDeletes"].as_array_mut() {
                for r in records.iter_mut().filter(|r| r["key"] == record["key"]) { r["ready"] = json!(true); }
            }
            self.storage.save(&next).map(|_| { *data = next; })
        };
        if let Err(e) = saved {
            if let (Some(source), Some(destination)) = (&source, &destination) {
                std::fs::rename(destination, source).map_err(|rollback| format!("保存失败：{e}；工作目录恢复失败：{rollback}。请重启应用恢复，勿启动此任务。"))?;
                self.remove_delete_record(text(&record, "key")).await?;
            }
            return Err(e);
        }
        self.delete_progress(id, "removed", "任务已移除，文件将在后台清理", started);
        self.start_delete_cleanup();
        Ok(json!({"cleanupPending":source.is_some()}))
    }

    async fn remove_delete_record(&self, key: &str) -> Result<()> {
        let mut data = self.data.lock().await;
        let mut next = data.clone();
        if let Some(records) = next["pendingDeletes"].as_array_mut() { records.retain(|r| text(r, "key") != key); }
        self.storage.save(&next)?;
        *data = next;
        Ok(())
    }

    pub(super) fn start_delete_cleanup(self: &Arc<Self>) {
        self.delete_wake.notify_one();
        if self.delete_cleaner_started.swap(true, Ordering::SeqCst) { return; }
        let weak = Arc::downgrade(self);
        let wake = self.delete_wake.clone();
        tokio::spawn(async move {
            loop {
                let Some(rt) = weak.upgrade() else { break; };
                rt.clean_deleted_files().await;
                drop(rt);
                tokio::select! {
                    _ = wake.notified() => {},
                    _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {},
                }
            }
        });
    }

    async fn clean_deleted_files(&self) {
        let records = self.data.lock().await["pendingDeletes"].as_array().cloned().unwrap_or_default();
        for record in records.into_iter().filter(|r| r["ready"] == true) {
            let key = text(&record, "key").to_owned();
            let root = self.root.clone();
            let copy = key.clone();
            let started = Instant::now();
            let result = tokio::task::spawn_blocking(move || -> Result<()> {
                let path = trash_path(&root, &copy)?;
                match std::fs::remove_dir_all(&path) {
                    Ok(()) => Ok(()),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(e) => Err(e.to_string()),
                }
            }).await.map_err(|e| e.to_string()).and_then(|r| r);
            eprintln!("delete cleanup={key} elapsedMs={} success={}", started.elapsed().as_millis(), result.is_ok());
            let result = match result { Ok(()) => self.remove_delete_record(&key).await, Err(e) => Err(e) };
            if let Err(error) = result {
                let mut data = self.data.lock().await;
                let mut next = data.clone();
                if let Some(r) = next["pendingDeletes"].as_array_mut().and_then(|rs| rs.iter_mut().find(|r| text(r, "key") == key)) {
                    r["lastError"] = json!(error);
                    r["attempts"] = json!(r["attempts"].as_u64().unwrap_or(0) + 1);
                }
                if self.storage.save(&next).is_ok() { *data = next; }
                if record["lastError"].is_null() {
                    (self.emit)("desktop:error", json!(format!("任务已移除，但文件清理失败，将自动重试：{error}")));
                }
            }
        }
    }
}
