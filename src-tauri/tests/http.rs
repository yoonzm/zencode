use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use zencode_core::services::{sync, Api};
async fn server(handler: Arc<dyn Fn(&str, &str) -> (u16, Value) + Send + Sync>) -> String {
    raw_server(Arc::new(move |route, request| {
        let (status, body) = handler(route, request);
        (status, body.to_string())
    })).await
}
async fn raw_server(handler: Arc<dyn Fn(&str, &str) -> (u16, String) + Send + Sync>) -> String {
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
async fn sync_always_limits_products_and_applies_assignee_scope() {
    let calls = Arc::new(Mutex::new(vec![]));
    let log = calls.clone();
    let base = server(Arc::new(move |route, _| {
        log.lock().unwrap().push(route.to_string());
        if route.starts_with("/api.php/v1/products?") {
            return (200, json!({"products":[{"id":1,"name":"Mapped"},{"id":2,"name":"Unmapped"}]}));
        }
        for (plural, first) in [("bugs", 7), ("stories", 9)] {
            if route.starts_with(&format!("/api.php/v1/products/1/{plural}?")) {
                return (200, json!({plural:[{"id":first,"assignedTo":{"account":"alice"}},{"id":first+1,"assignedTo":"bob"}]}));
            }
            for (id, account) in [(first, "alice"), (first + 1, "bob")] {
                if route == format!("/api.php/v1/{plural}/{id}") {
                    return (200, json!({"id":id,"title":"Task","assignedTo":account}));
                }
            }
        }
        (404, json!({}))
    })).await;
    for scope in ["mine", "products"] {
        for mapped in [true, false] {
            calls.lock().unwrap().clear();
            let config = json!({
                "zentao":{"baseUrl":base,"auth":"token","secret":"fixture","account":"alice","scope":scope},
                "mappings":if mapped {json!([{"product":"Mapped","repo":"team/app"}])} else {json!([])}
            });
            let (tasks, products) = sync(&config).await.unwrap();
            assert_eq!(products, vec!["Mapped", "Unmapped"]);
            assert_eq!(tasks.len(), if !mapped {0} else if scope == "mine" {2} else {4});
            assert!(tasks.iter().all(|t| t["repoId"] == "team/app"));
            let calls = calls.lock().unwrap();
            assert!(!calls.iter().any(|p| p.contains("/products/2/")));
            if !mapped {
                assert_eq!(calls.len(), 1, "No mappings must not request any task lists or details");
            } else if scope == "mine" {
                assert!(!calls.iter().any(|p| p.ends_with("/8") || p.ends_with("/10")));
                assert!(tasks.iter().all(|t| t["assignee"] == "me"));
            } else {
                assert!(calls.iter().any(|p| p.ends_with("/8")));
                assert!(calls.iter().any(|p| p.ends_with("/10")));
            }
        }
    }
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
    let project_base = Arc::new(Mutex::new(String::new()));
    let response_base = project_base.clone();
    let link = "https://gitlab.example/team/app/-/merge_requests/4";
    let base=server(Arc::new(move|route,_request|{
        if route.starts_with("/api/v4/projects/"){return (200,json!({"id":9,"path_with_namespace":"team/app","http_url_to_repo":format!("{}/team/app.git",response_base.lock().unwrap())}));}
        if route=="/api.php/v1/comments"{let n=count.fetch_add(1,Ordering::SeqCst);return if n==0{(500,json!({"error":"temporary"}))}else{(200,json!({"id":5}))};}
        if route=="/api.php/v1/bugs/1"{return (200,json!({"id":1,"actions":if count.load(Ordering::SeqCst)>1{json!([{"comment":format!("ZenCode MR: {link}")}])}else{json!([])}}));}
        if route.starts_with("/api.php/v2/actions/comment"){return (404,json!({}));}
        panic!("Unexpected request: {route}");
    })).await;
    *project_base.lock().unwrap() = base.clone();
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
    // A valid fetch URL must not hide a different push destination, including
    // an additional push URL after the valid one.
    for push_urls in [vec!["https://wrong.example/team/app.git".to_owned()], vec![format!("{base}/team/app.git"), "https://wrong.example/team/app.git".to_owned()]] {
        for push_url in push_urls {
            command("git", &["remote", "set-url", "--add", "--push", "origin", &push_url], Some(&repo)).await.unwrap();
        }
        assert!(runtime.call("mr", args.clone()).await.unwrap_err().contains("推送目标"));
        assert_eq!(comments.load(Ordering::SeqCst), 0);
        command("git", &["config", "--unset-all", "remote.origin.pushurl"], Some(&repo)).await.unwrap();
    }
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

#[tokio::test]
async fn invalid_response_identifies_endpoint_without_leaking_body() {
    let base = raw_server(Arc::new(|route, _| {
        (200, if route == "/empty" { "" } else { "<html>private-token-and-content</html>" }.into())
    })).await;
    let api = Api::new(&base, "", "Token", "secret").unwrap();
    let error = api.request("/empty", "GET", None).await.unwrap_err();
    assert!(error.contains("空响应") && error.contains("200") && error.contains("/empty"));
    let error = api.request("/html?token=hidden", "GET", None).await.unwrap_err();
    assert!(error.contains("JSON") && error.contains("/html"));
    assert!(!error.contains("hidden") && !error.contains("private-token"));
}

#[tokio::test]
async fn empty_comment_response_requires_readback_and_preserves_mr_for_retry() {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use zencode_core::{runtime::Runtime, services::{command, empty_run}, storage::Storage};
    for saved in [false, true] {
        let stored = Arc::new(AtomicBool::new(false));
        let readback = stored.clone();
        let writes = Arc::new(AtomicUsize::new(0));
        let count = writes.clone();
        let base_value = Arc::new(Mutex::new(String::new()));
        let response_base = base_value.clone();
        let link = "https://gitlab.example/team/app/-/merge_requests/4";
        let base = raw_server(Arc::new(move |route, request| {
            if route.starts_with("/api/v4/projects/") {
                assert!(request.starts_with("GET "), "Must not create another MR");
                return (200, json!({"id":9,"http_url_to_repo":format!("{}/team/app.git",response_base.lock().unwrap())}).to_string());
            }
            if route.starts_with("/api.php/v2/actions/comment?") {
                count.fetch_add(1, Ordering::SeqCst);
                readback.store(saved, Ordering::SeqCst);
                return (200, String::new());
            }
            if route == "/api.php/v1/bugs/1" {
                return (200, json!({"actions":if readback.load(Ordering::SeqCst) {json!([{"comment":link}])} else {json!([])}}).to_string());
            }
            panic!("Unexpected route {route}; ambiguous writes must not fall back to another POST");
        })).await;
        *base_value.lock().unwrap() = base.clone();
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir(&repo).unwrap();
        command("git", &["init", "-b", "main"], Some(&repo)).await.unwrap();
        command("git", &["remote", "add", "origin", &format!("{base}/team/app.git")], Some(&repo)).await.unwrap();
        let mut run = empty_run();
        run["state"] = json!("review");
        run["worktree"] = json!(repo);
        run["mr"] = json!({"iid":4,"url":link});
        run["mapping"] = json!({"repo":"team/app","branch":"main"});
        let root = dir.path().join("data");
        Storage::new(&root).save(&json!({"prefs":{},"tasks":[{"id":"bug-1","no":1,"kind":"bug","run":run}]})).unwrap();
        let runtime = Runtime::new(root, Arc::new(|_, _| {})).unwrap();
        let args = json!({"id":"bug-1","config":{"gitlab":{"baseUrl":base,"token":"fixture"},"zentao":{"baseUrl":base,"auth":"token","secret":"fixture"}}});
        let result = runtime.call("mr", args.clone()).await;
        if saved {
            result.unwrap();
        } else {
            let error = result.unwrap_err();
            assert!(error.contains("MR 已创建") && error.contains("空响应"));
            let data = runtime.data.lock().await;
            assert_eq!(data["tasks"][0]["run"]["state"], "review");
            assert_eq!(data["tasks"][0]["run"]["mr"]["iid"], 4);
            assert!(data["tasks"][0]["run"]["writebackError"].as_str().unwrap().contains("空响应"));
            drop(data);
            // A manual comment or delayed server write must be detected without another POST.
            stored.store(true, Ordering::SeqCst);
            runtime.call("mr", args).await.unwrap();
        }
        let data = runtime.data.lock().await;
        assert_eq!(data["tasks"][0]["run"]["state"], "done");
        assert!(data["tasks"][0]["run"].get("writebackError").is_none());
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }
}
