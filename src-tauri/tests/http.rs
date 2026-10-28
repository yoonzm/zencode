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
