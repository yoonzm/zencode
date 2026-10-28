use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use zencode_core::services::{sync, Api};
async fn server(handler: Arc<dyn Fn(&str, &str) -> (u16, Value) + Send + Sync>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let handler = handler.clone();
            tokio::spawn(async move {
                let mut buf = vec![0; 65536];
                let n = socket.read(&mut buf).await.unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                let route = req.split_whitespace().nth(1).unwrap_or("");
                let (status, body) = handler(route, &req);
                let body = body.to_string();
                let response=format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
            });
        }
    });
    format!("http://{addr}")
}
#[tokio::test]
async fn sync_uses_token_and_filters_real_assignee() {
    let calls = Arc::new(Mutex::new(vec![]));
    let log = calls.clone();
    let base=server(Arc::new(move|route,request|{assert!(request.to_lowercase().contains("token: test-token"));log.lock().unwrap().push(route.to_string());if route.starts_with("/api.php/v1/products?"){(200,json!({"products":[{"id":1,"name":"P"}]}))}else if route.starts_with("/api.php/v1/products/1/bugs?"){(200,json!({"bugs":[{"id":7,"assignedTo":{"account":"alice"}},{"id":8,"assignedTo":{"account":"bob"}}]}))}else if route.starts_with("/api.php/v1/products/1/stories?"){(200,json!({"stories":[]}))}else if route=="/api.php/v1/bugs/7"{(200,json!({"id":7,"title":"Real title","steps":"Description","assignedTo":{"account":"alice"},"files":{"22":{"id":22,"title":"sample.txt","size":10}},"actions":[{"actor":"alice","action":"opened","comment":"details"}]}))}else{(404,json!({}))}})).await;
    let config = json!({"zentao":{"baseUrl":base,"auth":"token","secret":"test-token","account":"alice","scope":"mine"},"mappings":[{"product":"P","repo":"team/app"}]});
    let (tasks, products) = sync(&config).await.unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["id"], "bug-7");
    assert_eq!(tasks[0]["repoId"], "team/app");
    assert_eq!(tasks[0]["attachments"][0]["id"], 22);
    assert_eq!(products, vec!["P"]);
    assert!(!calls.lock().unwrap().iter().any(|p| p.ends_with("/8")));
}
#[tokio::test]
async fn paginate_and_reject_http_auth_failure() {
    let base=server(Arc::new(|route,_|{if route.contains("denied"){(401,json!({"token":"must-not-leak"}))}else if route.contains("page=1&"){(200,json!({"products":(0..100).map(|i|json!({"id":i})).collect::<Vec<_>>(),"total":101}))}else{(200,json!({"products":[{"id":100}],"total":101}))}})).await;
    let api = Api::new(&base, "", "Token", "secret").unwrap();
    assert_eq!(api.pages("/products", "products").await.unwrap().len(), 101);
    let error = api.request("/denied", "GET", None).await.unwrap_err();
    assert!(error.contains("401"));
    assert!(!error.contains("must-not-leak"));
}

#[tokio::test]
async fn writeback_retry_preserves_existing_mr_and_verifies_history() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use zencode_core::{
        runtime::Runtime,
        services::{command, empty_run},
        storage::Storage,
    };
    let comments = Arc::new(AtomicUsize::new(0));
    let count = comments.clone();
    let link = "https://gitlab.example/team/app/-/merge_requests/4";
    let base=server(Arc::new(move|route,_request|{
        if route.starts_with("/api/v4/projects/"){return (200,json!({"id":9,"path_with_namespace":"team/app"}));}
        if route=="/api.php/v1/comments"{let n=count.fetch_add(1,Ordering::SeqCst);return if n==0{(500,json!({"error":"temporary"}))}else{(200,json!({"id":5}))};}
        if route=="/api.php/v1/bugs/1"{return (200,json!({"id":1,"actions":if count.load(Ordering::SeqCst)>1{json!([{"comment":format!("ZenCode MR: {link}")}])}else{json!([])}}));}
        if route.starts_with("/api.php/v2/actions/comment"){return (404,json!({}));}
        panic!("Unexpected request: {route}");
    })).await;
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    command("git", &["init", "-b", "main"], Some(&repo))
        .await
        .unwrap();
    command(
        "git",
        &["remote", "add", "origin", &format!("{base}/team/app.git")],
        Some(&repo),
    )
    .await
    .unwrap();
    let mut run = empty_run();
    run["state"] = json!("review");
    run["worktree"] = json!(repo);
    run["mr"] = json!({"iid":4,"url":link});
    run["mapping"] = json!({"repo":"team/app","branch":"main"});
    let data = dir.path().join("data");
    Storage::new(&data).save(&json!({"prefs":{},"tasks":[{"id":"bug-1","no":1,"kind":"bug","title":"Fix","run":run}]})).unwrap();
    let runtime = Runtime::new(data, Arc::new(|_, _| {})).unwrap();
    let args = json!({"id":"bug-1","config":{"gitlab":{"baseUrl":base,"token":"test-pat"},"zentao":{"baseUrl":base,"auth":"token","secret":"test-token"}}});
    assert!(runtime
        .call("mr", args.clone())
        .await
        .unwrap_err()
        .contains("500"));
    assert_eq!(
        runtime.data.lock().await["tasks"][0]["run"]["state"],
        "review"
    );
    assert_eq!(runtime.data.lock().await["tasks"][0]["run"]["mr"]["iid"], 4);
    runtime.call("mr", args).await.unwrap();
    assert_eq!(
        runtime.data.lock().await["tasks"][0]["run"]["state"],
        "done"
    );
    assert_eq!(comments.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn modern_comment_does_not_mutate_task_status() {
    let base = server(Arc::new(|route, request| {
        assert_eq!(
            route,
            "/api.php/v2/actions/comment?objectType=bug&objectID=7"
        );
        assert!(request.contains("ZenCode MR:"));
        assert!(!request.contains("resolution"));
        assert!(!request.contains("closedReason"));
        (200, json!({"status":"success","data":42}))
    }))
    .await;
    let api = Api::new(&base, "/api.php/v1", "Token", "test").unwrap();
    api.comment("bug", 7, "https://example.test/mr/1")
        .await
        .unwrap();
}
