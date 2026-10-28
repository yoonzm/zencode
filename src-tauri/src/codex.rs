use crate::{services::executable, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin},
    sync::{mpsc, oneshot, Mutex},
};
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>;
pub struct Session {
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Pending,
    seq: AtomicU64,
}
impl Session {
    pub async fn spawn(
        file: &str,
        cwd: &Path,
    ) -> Result<(Arc<Self>, mpsc::UnboundedReceiver<Value>)> {
        let mut cmd = executable(
            if file.is_empty() { "codex" } else { file },
            &["app-server".into(), "--listen".into(), "stdio://".into()],
        )?;
        cmd.current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd.spawn().map_err(|e| format!("启动 Codex 失败：{e}"))?;
        let input = child.stdin.take().ok_or("无法写入 Codex")?;
        let stdout = child.stdout.take().ok_or("无法读取 Codex")?;
        let stderr = child.stderr.take().ok_or("无法读取 Codex 错误流")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let other = pending.clone();
        let (tx, rx) = mpsc::unbounded_channel();
        let errtx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = errtx.send(json!({"method":"zencode/stderr","params":{"text":line}}));
            }
        });
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.len() > 8_000_000 {
                    break;
                }
                match serde_json::from_str::<Value>(&line) {
                    Ok(v) if v.get("method").is_some() => {
                        let _ = tx.send(v);
                    }
                    Ok(v) => {
                        if let Some(id) = v["id"].as_u64() {
                            if let Some(waiter) = other.lock().await.remove(&id) {
                                let _ = waiter.send(if v.get("error").is_some() {
                                    Err(crate::text(&v["error"], "message").into())
                                } else {
                                    Ok(v["result"].clone())
                                });
                            }
                        }
                    }
                    Err(_) => {
                        let _ = tx.send(json!({"method":"zencode/protocolError","params":{}}));
                        break;
                    }
                }
            }
            for (_, waiter) in other.lock().await.drain() {
                let _ = waiter.send(Err("Codex 连接已关闭".into()));
            }
            let _ = tx.send(json!({"method":"zencode/closed","params":{}}));
        });
        Ok((
            Arc::new(Self {
                input: Mutex::new(input),
                child: Mutex::new(child),
                pending,
                seq: AtomicU64::new(1),
            }),
            rx,
        ))
    }
    pub async fn send(&self, v: Value) -> Result<()> {
        let bytes = serde_json::to_vec(&v).map_err(|e| e.to_string())?;
        let mut input = self.input.lock().await;
        input.write_all(&bytes).await.map_err(|e| e.to_string())?;
        input.write_all(b"\n").await.map_err(|e| e.to_string())
    }
    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.seq.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        if let Err(e) = self
            .send(json!({"id":id,"method":method,"params":params}))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(e);
        }
        let result = tokio::time::timeout(Duration::from_secs(30), rx).await;
        self.pending.lock().await.remove(&id);
        result
            .map_err(|_| format!("Codex {method} 超时"))?
            .map_err(|_| "Codex 连接已关闭".to_string())?
    }
    pub async fn initialize(&self) -> Result<Value> {
        let v=self.request("initialize",json!({"clientInfo":{"name":"zencode","title":"ZenCode","version":"0.1.0"},"capabilities":{"experimentalApi":false}})).await?;
        self.send(json!({"method":"initialized","params":{}}))
            .await?;
        Ok(v)
    }
    pub async fn close(&self) {
        let _ = self.child.lock().await.kill().await;
    }
}
