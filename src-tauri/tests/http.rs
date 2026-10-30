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

#[tokio::test]
async fn deleted_task_syncs_back_with_fresh_run_without_remote_writes() {
    use zencode_core::{runtime::Runtime, services::empty_run, storage::Storage};
    let base = server(Arc::new(|route, request| {
        assert!(request.starts_with("GET "), "Local deletion must not write to ZenTao");
        if route.starts_with("/api.php/v1/products?") {
            (200, json!({"products":[{"id":1,"name":"P"}]}))
        } else if route.starts_with("/api.php/v1/products/1/bugs?") {
            (200, json!({"bugs":[{"id":7,"assignedTo":"alice"}]}))
        } else if route.starts_with("/api.php/v1/products/1/stories?") {
            (200, json!({"stories":[]}))
        } else if route == "/api.php/v1/bugs/7" {
            (200, json!({"id":7,"title":"Remote task","status":"active","assignedTo":"alice"}))
        } else { (404, json!({})) }
    })).await;
    let dir = tempfile::tempdir().unwrap();
    let retained = dir.path().join("worktree.txt");
    std::fs::write(&retained, "existing user changes").unwrap();
    let workspace = dir.path().join("worktrees/bug-7");
    std::fs::create_dir_all(&workspace).unwrap();
    let mut run = empty_run();
    run["state"] = json!("done");
    run["worktree"] = json!(workspace);
    run["branch"] = json!("old-branch");
    run["threadId"] = json!("old-thread");
    run["mr"] = json!({"iid":1});
    Storage::new(dir.path()).save(&json!({"prefs":{},"tasks":[{"id":"bug-7","run":run}]})).unwrap();
    let rt = Runtime::new(dir.path().into(), Arc::new(|_, _| {})).unwrap();
    rt.call("delete", json!({"id":"bug-7"})).await.unwrap();
    assert!(Storage::new(dir.path()).load().unwrap()["tasks"].as_array().unwrap().is_empty());
    let tasks = rt.call("sync", json!({"config":{
        "zentao":{"baseUrl":base,"auth":"token","secret":"test-token","account":"alice","scope":"mine","autoRun":false},
        "mappings":[{"product":"P","repo":"team/app"}]
    }})).await.unwrap();
    assert_eq!(tasks.as_array().unwrap().len(), 1);
    assert_eq!(tasks[0]["id"], "bug-7");
    assert_eq!(tasks[0]["run"], empty_run());
    assert_eq!(std::fs::read_to_string(retained).unwrap(), "existing user changes");
    assert!(!workspace.exists());
}
#[tokio::test]
async fn automatic_cleanup_suppresses_closed_tasks_and_reimports_open_tasks_without_running() {
    use zencode_core::{runtime::Runtime, storage::Storage};
    let closed = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let remote = closed.clone();
    let base = server(Arc::new(move |route, request| {
        assert!(request.starts_with("GET "));
        if route.contains("/products?") { (200, json!({"products":[{"id":1,"name":"P"}]})) }
        else if route.contains("/products/1/bugs?") { (200, json!({"bugs":[{"id":7,"assignedTo":"alice"}]})) }
        else if route.contains("/products/1/stories?") { (200, json!({"stories":[]})) }
        else if route.ends_with("/bugs/7") { (200, json!({"id":7,"title":"Task","assignedTo":"alice","status":if remote.load(std::sync::atomic::Ordering::SeqCst) {"closed"} else {"active"}})) }
        else { (404, json!({})) }
    })).await;
    let dir = tempfile::tempdir().unwrap();
    Storage::new(dir.path()).save(&json!({"prefs":{},"tasks":[{"id":"bug-7","kind":"bug","no":7,"repoId":"team/app","product":"P","updatedAt":1,"run":{"state":"failed"}}]})).unwrap();
    let rt = Runtime::new(dir.path().into(), Arc::new(|_, _| {})).unwrap();
    rt.call("cleanup", json!({"mode":"auto","days":30})).await.unwrap();
    let rt = Runtime::new(dir.path().into(), Arc::new(|_, _| {})).unwrap();
    let args = json!({"config":{"zentao":{"baseUrl":base,"auth":"token","secret":"fixture","account":"alice","scope":"mine","autoRun":true},"mappings":[{"product":"P","repo":"team/app"}]}});
    assert_eq!(rt.call("sync", args.clone()).await.unwrap(), json!([]));
    closed.store(false, std::sync::atomic::Ordering::SeqCst);
    for _ in 0..2 {
        let tasks = rt.call("sync", args.clone()).await.unwrap();
        assert_eq!(tasks.as_array().unwrap().len(), 1);
        assert_eq!(tasks[0]["run"]["state"], "idle");
    }
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
async fn multi_repo_sync_preserves_legacy_runs_and_stable_repo_identity() {
    use zencode_core::{runtime::Runtime, services::empty_run, storage::Storage};
    let base = server(Arc::new(|route, request| {
        assert!(request.starts_with("GET "));
        if route.starts_with("/api.php/v1/products?") { (200, json!({"products":[{"id":1,"name":"P"}]})) }
        else if route.starts_with("/api.php/v1/products/1/bugs?") { (200, json!({"bugs":[{"id":7}]})) }
        else if route.starts_with("/api.php/v1/products/1/stories?") { (200, json!({"stories":[]})) }
        else if route == "/api.php/v1/bugs/7" { (200, json!({"id":7,"title":"Shared task"})) }
        else { (404, json!({})) }
    })).await;
    let root = tempfile::tempdir().unwrap();
    let mut run = empty_run();
    run["state"] = json!("done");
    run["threadId"] = json!("keep-thread");
    Storage::new(root.path()).save(&json!({"prefs":{},"tasks":[{"id":"bug-7","kind":"bug","no":7,"repoId":"team/web","run":run}]})).unwrap();
    let rt = Runtime::new(root.path().into(), Arc::new(|_, _| {})).unwrap();
    let mut config = json!({"zentao":{"baseUrl":base,"auth":"token","secret":"fixture","autoRun":false},"mappings":[{"product":"P","repos":[{"repo":"team/web","branch":"main"},{"repo":"team/api","branch":"develop"}]}]});
    let first = rt.call("sync", json!({"config":config})).await.unwrap();
    assert_eq!(first.as_array().unwrap().len(), 2);
    assert_eq!(first[0]["id"], "bug-7");
    assert_eq!(first[0]["run"]["threadId"], "keep-thread");
    assert_eq!(first[1]["run"]["state"], "idle");
    config["mappings"][0]["repos"].as_array_mut().unwrap().reverse();
    let second = rt.call("sync", json!({"config":config})).await.unwrap();
    assert_eq!(second[0]["id"], first[1]["id"]);
    assert_eq!(second[1]["id"], first[0]["id"]);
    assert_eq!(second[1]["run"]["threadId"], "keep-thread");
    rt.call("delete", json!({"id":first[1]["id"]})).await.unwrap();
    let third = rt.call("sync", json!({"config":config})).await.unwrap();
    assert_eq!(third[0]["run"]["state"], "idle");
    assert_eq!(third[1]["run"]["threadId"], "keep-thread");
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
async fn sync_includes_product_branches_across_story_pages() {
    let base = server(Arc::new(|route, _| {
        let url = url::Url::parse(&format!("http://localhost{route}")).unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
        match url.path() {
            "/api.php/v1/products" => (200, json!({"products":[{"id":241,"name":"Mapped"}]})),
            "/api.php/v1/products/241/bugs" => (200, json!({"bugs":[]})),
            "/api.php/v1/products/241/stories" => {
                // ZenTao omits stories in product branches unless explicitly requested.
                if query.get("branch").map(|v| v.as_ref()) != Some("all") {
                    return (200, json!({"stories":[],"total":0}));
                }
                let rows = if query.get("page").map(|v| v.as_ref()) == Some("1") {
                    (1..=100).map(|id| json!({"id":id,"branch":389,"assignedTo":if id == 1 {"alice"} else {"bob"}})).collect::<Vec<_>>()
                } else {
                    vec![json!({"id":101,"branch":390,"assignedTo":{"account":"alice"}})]
                };
                (200, json!({"stories":rows,"total":101}))
            }
            "/api.php/v1/stories/1" | "/api.php/v1/stories/101" => {
                let id: u64 = url.path().rsplit('/').next().unwrap().parse().unwrap();
                (200, json!({"id":id,"title":"Branch story","assignedTo":"alice"}))
            }
            _ => (404, json!({})),
        }
    })).await;
    let config = json!({"zentao":{"baseUrl":base,"auth":"token","secret":"fixture","account":"alice","scope":"mine"},"mappings":[{"product":"Mapped","repo":"team/app"}]});
    let (tasks, _) = sync(&config).await.unwrap();
    assert_eq!(tasks.iter().map(|t| t["id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["story-1", "story-101"]);
    assert!(tasks.iter().all(|t| t["repoId"] == "team/app" && t["assignee"] == "me"));
}

#[tokio::test]
async fn submission_preserves_existing_mr_without_zentao_requests() {
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
    runtime.call("mr", args).await.unwrap();
    let data = runtime.data.lock().await;
    assert_eq!(data["tasks"][0]["run"]["state"], "done");
    assert_eq!(data["tasks"][0]["run"]["mr"]["iid"], 4);
    assert_eq!(comments.load(Ordering::SeqCst), 0);

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
async fn legacy_pending_mr_finishes_without_zentao_access() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use zencode_core::{runtime::Runtime, services::{command, empty_run}, storage::Storage};
    for status in ["active", "resolved"] {
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
            count.fetch_add(1, Ordering::SeqCst);
            (503, String::new())

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
        run["writebackError"] = json!("legacy error");
        let root = dir.path().join("data");
        Storage::new(&root).save(&json!({"prefs":{},"tasks":[{"id":"bug-1","no":1,"kind":"bug","ztStatus":status,"run":run}]})).unwrap();
        let runtime = Runtime::new(root, Arc::new(|_, _| {})).unwrap();
        let args = json!({"id":"bug-1","config":{"gitlab":{"baseUrl":base,"token":"fixture"},"zentao":{"baseUrl":base,"auth":"token","secret":"fixture"}}});
        runtime.call("mr", args).await.unwrap();
        let data = runtime.data.lock().await;
        assert_eq!(data["tasks"][0]["run"]["state"], "done");
        assert!(data["tasks"][0]["run"].get("writebackError").is_none());
        assert_eq!(data["tasks"][0]["ztStatus"], status);
        assert_eq!(writes.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn gitlab_repository_and_branch_lists_paginate() {
    use zencode_core::runtime::Runtime;
    let base = server(Arc::new(|route, request| {
        assert!(request.starts_with("GET "));
        if route.starts_with("/api/v4/projects?simple=true&per_page=100&page=1") {
            (200, json!((0..100).map(|i| json!({"path_with_namespace":format!("team/repo{i}"),"default_branch":"main"})).collect::<Vec<_>>()))
        } else if route.starts_with("/api/v4/projects?simple=true&per_page=100&page=2") {
            (200, json!([{"path_with_namespace":"team/last","default_branch":"develop"}]))
        } else if route.starts_with("/api/v4/projects/team%2Flast/repository/branches?") {
            (200, json!([{"name":"develop"},{"name":"release/1"}]))
        } else { (404, json!({})) }
    })).await;
    let root = tempfile::tempdir().unwrap();
    let rt = Runtime::new(root.path().into(), Arc::new(|_, _| {})).unwrap();
    let config = json!({"gitlab":{"baseUrl":base,"token":"fixture"}});
    let repos = rt.call("gitlabRepos", json!({"config":config})).await.unwrap();
    assert_eq!(repos.as_array().unwrap().len(), 101);
    assert_eq!(repos[100]["defaultBranch"], "develop");
    let branches = rt.call("gitlabBranches", json!({"config":config,"repo":"team/last"})).await.unwrap();
    assert_eq!(branches, json!(["develop","release/1"]));
}

#[tokio::test]
async fn execution_clones_target_branch_without_local_mapping() {
    use zencode_core::{runtime::Runtime, services::{command, empty_run}, storage::Storage};
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    std::fs::create_dir(&source).unwrap();
    command("git", &["init", "-b", "develop"], Some(&source)).await.unwrap();
    command("git", &["config", "user.email", "fixture@example.invalid"], Some(&source)).await.unwrap();
    command("git", &["config", "user.name", "Fixture"], Some(&source)).await.unwrap();
    std::fs::write(source.join("selected.txt"), "target branch").unwrap();
    command("git", &["add", "."], Some(&source)).await.unwrap();
    command("git", &["commit", "-m", "fixture"], Some(&source)).await.unwrap();
    let clone_source = source.clone();
    let base = server(Arc::new(move |_, _| (200, json!({"http_url_to_repo":clone_source})))).await;
    let data = root.path().join("data");
    Storage::new(&data).save(&json!({"prefs":{},"tasks":[{"id":"bug-1","product":"P","repoId":"team/app","run":empty_run()}]})).unwrap();
    let rt = Runtime::new(data, Arc::new(|_, _| {})).unwrap();
    let config = json!({"gitlab":{"baseUrl":base,"token":"fixture"},"codex":{"cliPath":"missing-codex-fixture"},"mappings":[{"product":"P","repos":[{"repo":"team/other","branch":"missing"},{"repo":"team/app","branch":"develop"}]}]});
    rt.call("start", json!({"id":"bug-1","config":config})).await.unwrap();
    let mut worktree = String::new();
    for _ in 0..500 {
        let state = rt.data.lock().await.clone();
        if let Some(path) = state["tasks"][0]["run"]["worktree"].as_str() { worktree = path.into(); break; }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(!worktree.is_empty(), "clone must succeed before the intentionally missing CLI fails");
    let path = std::path::Path::new(&worktree);
    assert_ne!(path, source);
    assert_eq!(std::fs::read_to_string(path.join("selected.txt")).unwrap(), "target branch");
    assert!(path.join(".git").is_dir(), "execution has an independent clone");
    assert!(command("git", &["branch", "--show-current"], Some(path)).await.unwrap().starts_with("zencode/"));
    rt.shutdown().await;
}
