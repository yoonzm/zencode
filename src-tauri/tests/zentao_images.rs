use serde_json::json;
use std::sync::{Arc, Mutex};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};
use zencode_core::{runtime::Runtime, services::{Api, empty_run}, storage::Storage};

async fn fixture() -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let calls = Arc::new(Mutex::new(vec![]));
    let log = calls.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { break; };
            let log = log.clone();
            tokio::spawn(async move {
                let mut buffer = vec![0;65536];
                let size = socket.read(&mut buffer).await.unwrap();
                let request = String::from_utf8_lossy(&buffer[..size]);
                assert!(request.to_lowercase().contains("token: image-test-token"));
                let route = request.split_whitespace().nth(1).unwrap().to_owned();
                log.lock().unwrap().push(route.clone());
                let (status, mime, body) = match route.as_str() {
                    "/zentao/file-read-7.png" => (200, "text/html", b"<html>Login required</html>".as_slice()),
                    "/zentao/api.php/v1/files/7" | "/zentao/data/upload/image.png" => (200, "application/octet-stream", b"\x89PNG\r\n\x1a\nimage".as_slice()),
                    "/zentao/file-read-8.png" => (302, "text/html", b"redirect".as_slice()),
                    "/zentao/api.php/v1/files/8" => (403, "text/html", b"secret-server-error".as_slice()),
                    _ => (404, "text/plain", b"not found".as_slice()),
                };
                let header = format!("HTTP/1.1 {status} Test\r\nContent-Type: {mime}\r\nLocation: http://external.invalid/leak\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                socket.write_all(header.as_bytes()).await.unwrap();
                socket.write_all(body).await.unwrap();
            });
        }
    });
    (format!("{base}/zentao"), calls)
}

#[tokio::test]
async fn images_use_saved_auth_and_fall_back_from_login_page_without_following_redirects() {
    let (base, calls) = fixture().await;
    let api = Api::new(&base, "/api.php/v1", "Token", "image-test-token").unwrap();
    let image = api.image(&base, "file-read-7.png").await.unwrap();
    assert!(image.starts_with("data:image/png;base64,"));
    assert!(api.image(&base, "data/upload/image.png").await.unwrap().starts_with("data:image/png;base64,"));
    let error = api.image(&base, "file-read-8.png").await.unwrap_err();
    assert!(error.contains("403")); assert!(!error.contains("secret-server-error"));
    let count = calls.lock().unwrap().len();
    assert!(api.image(&base, "https://external.invalid/image.png").await.is_err());
    assert_eq!(calls.lock().unwrap().len(), count);
    assert!(calls.lock().unwrap().contains(&"/zentao/api.php/v1/files/7".into()));
}

#[tokio::test]
async fn runtime_only_loads_images_referenced_by_task_body_or_comments() {
    let (base, _) = fixture().await;
    let root = tempfile::tempdir().unwrap();
    Storage::new(root.path()).save(&json!({"prefs":{},"tasks":[{"id":"bug-7","description":[{"type":"p","text":"<p>详情<img src=\"data/upload/image.png\"></p>"}],"history":[{"text":"commented <img src=\"file-read-7.png\">"}],"run":empty_run()}]})).unwrap();
    let rt = Runtime::new(root.path().into(), Arc::new(|_,_| {})).unwrap();
    let config = json!({"zentao":{"baseUrl":base,"auth":"token","secret":"image-test-token"}});
    for src in ["data/upload/image.png", "file-read-7.png"] {
        let image = rt.call("zentaoImage", json!({"id":"bug-7","src":src,"config":config})).await.unwrap();
        assert!(image.as_str().unwrap().starts_with("data:image/png;base64,"));
    }
    assert!(rt.call("zentaoImage", json!({"id":"bug-7","src":"not-in-task.png","config":config})).await.unwrap_err().contains("不属于"));
}
