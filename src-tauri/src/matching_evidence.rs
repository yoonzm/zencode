use crate::{services::{self, Api}, text, Result};
use serde_json::{json, Value};

pub struct Evidence {
    pub products: Vec<Value>,
    pub projects: Vec<Value>,
    pub records: Vec<Value>,
    pub warnings: Vec<String>,
}

fn clipped(value: &Value) -> String {
    let raw = value.as_str().map(str::to_owned).unwrap_or_else(|| if value.is_null() { String::new() } else { value.to_string() });
    let mut out: String = raw.chars().take(1200).collect();
    if raw.chars().count() > 1200 { out.push_str("…[截断]"); }
    out
}

// Sample two pages per source, explicitly report limits and failures. Never silently
// turn a permission error into evidence that a product/repository has no activity.
async fn sample(api: &Api, route: &str, key: Option<&str>, warnings: &mut Vec<String>, label: &str) -> Vec<Value> {
    let mut rows = Vec::new();
    for page in 1..=2 {
        let pagination = if key.is_some() { "limit" } else { "per_page" };
        let result = api.request(&format!("{route}&{pagination}=25&page={page}"), "GET", None).await;
        let data = match result {
            Ok(data) => data,
            Err(e) => { warnings.push(format!("{label}：读取失败，{e}")); break; }
        };
        let items = key.map(|k| &data[k]).unwrap_or(&data);
        let Some(items) = items.as_array() else { warnings.push(format!("{label}：列表格式不兼容")); break; };
        rows.extend(items.iter().take(25).cloned());
        if items.len() < 25 || data["total"].as_u64().is_some_and(|n| n <= rows.len() as u64) { break; }
        if page == 2 { warnings.push(format!("{label}：仅分析前 50 条记录，可能还有更早记录")); }
    }
    rows
}

pub async fn collect(config: &Value) -> Result<Evidence> {
    let zt = services::zentao(&config["zentao"]).await?;
    let gl = services::gitlab(&config["gitlab"])?;
    let products = zt.pages("/products", "products").await?;
    let projects = gl.gitlab_pages("/projects?simple=true").await?;
    let mut evidence = Evidence { products, projects, records: vec![], warnings: vec![] };
    for product in &evidence.products {
        let Some(id) = product["id"].as_u64().or_else(|| product["id"].as_str()?.parse().ok()) else { return Err("产品缺少有效 ID".into()); };
        for (kind, plural) in [("bug", "bugs"), ("story", "stories")] {
            let route = format!("/products/{id}/{plural}?orderBy=id_desc{}", if kind == "story" { "&branch=all" } else { "" });
            let label = format!("{} / {kind}", text(product, "name"));
            for (index, mut row) in sample(&zt, &route, Some(plural), &mut evidence.warnings, &label).await.into_iter().enumerate() {
                // List endpoints may omit steps/spec. Enrich the ten newest records
                // per type without fetching every task body in a large product.
                if index < 10 {
                    if let Some(task_id) = row["id"].as_u64().or_else(|| row["id"].as_str()?.parse().ok()) {
                        match zt.request(&format!("/{plural}/{task_id}"), "GET", None).await {
                            Ok(detail) => if let (Some(row), Some(detail)) = (row.as_object_mut(), detail.as_object()) { row.extend(detail.clone()); },
                            Err(e) => evidence.warnings.push(format!("{label} #{task_id}：详情不可用，仅使用列表信息，{e}")),
                        }
                    }
                }
                evidence.records.push(json!({"sourceId":format!("zt:{id}:{kind}:{}",row["id"]),"product":product["name"],"kind":kind,"number":row["id"],"title":clipped(&row["title"]),"description":clipped(if kind == "bug" { &row["steps"] } else { &row["spec"] }),"module":clipped(&row["module"]),"openedBy":clipped(&row["openedBy"]),"assignedTo":clipped(&row["assignedTo"]),"resolvedBy":clipped(&row["resolvedBy"]),"createdAt":row["openedDate"],"updatedAt":row["lastEditedDate"]}));
            }
        }
    }
    let since = chrono::Utc::now() - chrono::Duration::days(90);
    let timestamp = url::form_urlencoded::byte_serialize(since.to_rfc3339().as_bytes()).collect::<String>();
    for project in &evidence.projects {
        let repo = text(project, "path_with_namespace");
        let encoded = url::form_urlencoded::byte_serialize(repo.as_bytes()).collect::<String>();
        for (kind, route) in [
            ("commit", format!("/projects/{encoded}/repository/commits?all=true&since={timestamp}")),
            ("mr", format!("/projects/{encoded}/merge_requests?scope=all&state=all&order_by=updated_at&sort=desc&updated_after={timestamp}")),
            ("event", format!("/projects/{encoded}/events?sort=desc&after={}", since.format("%Y-%m-%d"))),
        ] {
            let label = format!("{repo} / {kind}");
            for row in sample(&gl, &route, None, &mut evidence.warnings, &label).await {
                let (number, title, description, author, at) = match kind {
                    "commit" => (&row["id"], &row["title"], &row["message"], &row["author_name"], &row["committed_date"]),
                    "mr" => (&row["iid"], &row["title"], &row["description"], &row["author"]["username"], &row["updated_at"]),
                    _ => (&row["id"], &row["target_title"], &row["push_data"]["commit_title"], &row["author"]["username"], &row["created_at"]),
                };
                evidence.records.push(json!({"sourceId":format!("gl:{repo}:{kind}:{number}"),"repo":repo,"kind":kind,"number":number,"title":clipped(title),"description":clipped(description),"author":clipped(author),"at":at,"action":row["action_name"],"ref":row["push_data"]["ref"],"sourceBranch":row["source_branch"],"targetBranch":row["target_branch"]}));
            }
        }
    }
    Ok(evidence)
}

impl Evidence {
    pub fn prompt(&self) -> Result<String> {
        let prompt = json!({"scope":"Each product: up to 50 bugs and 50 stories ordered by descending ID. Each repository: up to 50 commits across all branches, 50 updated MRs and 50 events within 90 days. Samples are not complete histories.","products":self.products.iter().map(|p| text(p,"name")).collect::<Vec<_>>(),"repos":self.projects.iter().map(|p|json!({"repo":p["path_with_namespace"],"description":clipped(&p["description"]),"lastActivityAt":p["last_activity_at"]})).collect::<Vec<_>>(),"records":self.records,"warnings":self.warnings}).to_string();
        Ok(prompt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn reads_real_task_details_and_paginated_activity_without_writes() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = vec![0; 8192];
                let n = socket.read(&mut bytes).await.unwrap();
                let request = String::from_utf8_lossy(&bytes[..n]);
                assert!(request.starts_with("GET "));
                let route = request.split_whitespace().nth(1).unwrap();
                let (status, body) = if route.starts_with("/api.php/v1/products?") {
                    (200, json!({"products":[{"id":1,"name":"Payments"}]}))
                } else if route.starts_with("/api/v4/projects?simple=true") {
                    (200, json!([{"path_with_namespace":"team/pay","default_branch":"main"}]))
                } else if route.starts_with("/api.php/v1/products/1/bugs?") {
                    assert!(route.contains("orderBy=id_desc"));
                    (200, json!({"bugs":[{"id":42,"title":"Callback fails"}]}))
                } else if route.starts_with("/api.php/v1/products/1/stories?") {
                    assert!(route.contains("branch=all"));
                    (200, json!({"stories":[{"id":21,"title":"Refund support"}]}))
                } else if route == "/api.php/v1/bugs/42" {
                    (200, json!({"steps":"Callback signature is rejected","assignedTo":{"account":"alice"}}))
                } else if route == "/api.php/v1/stories/21" {
                    (200, json!({"spec":"Refund partial payments"}))
                } else if route.contains("/repository/commits?") {
                    assert!(route.contains("all=true&since="));
                    let offset = if route.contains("page=2") { 25 } else { 0 };
                    (200, json!((0..25).map(|i| json!({"id":format!("sha{}", i + offset),"title":"Fix ZenTao BUG #42 callback","message":"Fix ZenTao BUG #42 callback signature","author_name":"Alice"})).collect::<Vec<_>>()))
                } else if route.contains("/merge_requests?") {
                    assert!(route.contains("updated_after="));
                    (200, json!([{"iid":7,"title":"Implement story #21","description":"Refund partial payments","author":{"username":"alice"},"source_branch":"story-21"}]))
                } else if route.contains("/events?") { (403, json!({"message":"forbidden"})) }
                else { panic!("Unexpected request: {route}"); };
                let body = body.to_string();
                socket.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        let evidence = collect(&json!({"zentao":{"baseUrl":base,"auth":"token","secret":"zt-secret"},"gitlab":{"baseUrl":base,"token":"gl-secret"}})).await.unwrap();
        assert_eq!(evidence.records.len(), 53);
        assert!(evidence.records.iter().any(|r| r["description"] == "Callback signature is rejected"));
        assert!(evidence.records.iter().any(|r| r["description"] == "Refund partial payments"));
        assert!(evidence.records.iter().any(|r| r["sourceId"] == "gl:team/pay:commit:\"sha49\""));
        assert!(evidence.warnings.iter().any(|w| w.contains("403")));
        assert!(evidence.warnings.iter().any(|w| w.contains("50")));
        let prompt = evidence.prompt().unwrap();
        assert!(!prompt.contains("zt-secret") && !prompt.contains("gl-secret"));
        assert!(!prompt.contains("baseUrl"));
        server.abort();
    }

    #[test]
    fn long_unicode_text_is_explicitly_truncated() {
        let s = clipped(&json!("支付".repeat(1000)));
        assert!(s.ends_with("…[截断]"));
        assert!(s.starts_with("支付"));
    }

    #[tokio::test]
    async fn catalogs_above_previous_limits_are_collected() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = vec![0; 8192];
                let n = socket.read(&mut bytes).await.unwrap();
                let request = String::from_utf8_lossy(&bytes[..n]);
                assert!(request.starts_with("GET "));
                let route = request.split_whitespace().nth(1).unwrap();
                let body = if route.starts_with("/api.php/v1/products?") {
                    json!({"products":(1..=51).map(|id| json!({"id":id,"name":format!("P{id}")})).collect::<Vec<_>>()})
                } else if route.starts_with("/api/v4/projects?simple=true") {
                    let range = if route.contains("page=2") { 100..101 } else { 0..100 };
                    json!(range.map(|id| json!({"path_with_namespace":format!("team/r{id}"),"default_branch":"main"})).collect::<Vec<_>>())
                } else if route.contains("/bugs?") { json!({"bugs":[]}) }
                else if route.contains("/stories?") { json!({"stories":[]}) }
                else { json!([]) }.to_string();
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
            }
        });
        let evidence = collect(&json!({"zentao":{"baseUrl":base,"auth":"token","secret":"fixture"},"gitlab":{"baseUrl":base,"token":"fixture"}})).await.unwrap();
        assert_eq!(evidence.products.len(), 51);
        assert_eq!(evidence.projects.len(), 101);
        assert!(evidence.warnings.is_empty());
        server.abort();
    }
}
