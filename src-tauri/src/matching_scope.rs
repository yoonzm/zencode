use crate::{services::Api, text, Result};
use serde_json::Value;
use std::collections::HashSet;

fn number(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str()?.parse().ok())
}

/// REST v1 /user delegates these fields to the same my.bug/my.story controllers
/// used by the workbench, so it preserves token authentication and permissions.
pub async fn assigned_products(api: &Api, account: &str) -> Result<Vec<Value>> {
    let mut product_ids = HashSet::new();
    let mut products = Vec::new();
    for (field, key) in [("bug", "bugs"), ("story", "stories")] {
        let mut seen = HashSet::new();
        for page in 1u64.. {
            let response = api.request(&format!("/user?fields={field}&type=assignedTo&order=assignedDate_desc&limit=100&page={page}"), "GET", None).await?;
            let actual = text(&response["profile"], "account");
            if actual.is_empty() || (!account.is_empty() && actual != account) {
                return Err("禅道 Token 对应账号与配置账号不一致，或接口未返回登录身份，请检查禅道设置".into());
            }
            let section = &response[field];
            let rows = section[key].as_array().ok_or("当前禅道版本未返回个人工作台 BUG／需求列表，请确认 /user 的 fields 参数支持和「我的地盘」权限；未使用全部产品替代")?;
            let total = number(&section["total"]).ok_or("个人工作台响应缺少记录总数")?;
            if rows.is_empty() {
                if seen.len() < total as usize { return Err("个人工作台分页提前结束，请检查接口兼容性".into()); }
                break;
            }
            let before = seen.len();
            for row in rows {
                let id = number(&row["id"]).ok_or("个人工作台任务缺少有效 ID")?;
                if !seen.insert(id) { continue; }
                let assigned = row["assignedTo"].as_str().or_else(|| row["assignedTo"]["account"].as_str());
                if assigned.is_some_and(|a| a != actual) { return Err("个人工作台返回了非当前账号的指派任务，已停止分析".into()); }
                let product = number(&row["product"]).or_else(|| number(&row["product"]["id"]))
                    .filter(|id| *id > 0).ok_or("个人工作台任务缺少有效产品 ID")?;
                if product_ids.insert(product) {
                    let detail = api.request(&format!("/products/{product}"), "GET", None).await?;
                    if text(&detail, "name").is_empty() || number(&detail["id"]) != Some(product) { return Err("产品详情缺少有效名称或 ID".into()); }
                    products.push(detail);
                }
            }
            if seen.len() == before { return Err("个人工作台接口重复返回同一页，无法完成分页".into()); }
            if seen.len() >= total as usize { break; }
        }
    }
    Ok(products)
}

async fn pages(api: &Api, route: &str) -> Result<Vec<Value>> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for page in 1u64.. {
        let data = api.request(&format!("{route}&per_page=100&page={page}"), "GET", None).await?;
        let rows = data.as_array().ok_or("GitLab 用户活动列表格式无效")?;
        if rows.is_empty() { break; }
        let before = seen.len();
        for row in rows {
            if seen.insert(row["id"].to_string()) { result.push(row.clone()); }
        }
        if seen.len() == before { return Err("GitLab 用户活动接口重复返回同一页".into()); }
        if rows.len() < 100 { break; }
    }
    Ok(result)
}

/// Discover repositories from the authenticated user's recent participation,
/// never from all visible GitLab projects or an assumed matching username.
pub async fn user_projects(api: &Api, warnings: &mut Vec<String>) -> Result<Vec<Value>> {
    let user = api.request("/user", "GET", None).await?;
    let id = number(&user["id"]).ok_or("GitLab 未返回当前用户 ID")?;
    let since = chrono::Utc::now() - chrono::Duration::days(90);
    let timestamp = url::form_urlencoded::byte_serialize(since.to_rfc3339().as_bytes()).collect::<String>();
    let mut candidates = HashSet::new();
    let mut succeeded = false;
    let routes = [
        format!("/users/{id}/events?after={}&sort=desc", since.format("%Y-%m-%d")),
        format!("/merge_requests?scope=all&author_id={id}&state=all&updated_after={timestamp}&order_by=updated_at&sort=desc"),
        format!("/merge_requests?scope=all&assignee_id={id}&state=all&updated_after={timestamp}&order_by=updated_at&sort=desc"),
        format!("/merge_requests?scope=all&reviewer_id={id}&state=all&updated_after={timestamp}&order_by=updated_at&sort=desc"),
    ];
    for route in routes {
        match pages(api, &route).await {
            Ok(rows) => {
                succeeded = true;
                for row in rows {
                    if let Some(project) = number(&row["project_id"]).filter(|n| *n > 0) { candidates.insert(project); }
                }
            }
            Err(e) => warnings.push(format!("GitLab 用户参与记录读取不完整：{e}")),
        }
    }
    if !succeeded { return Err("无法读取 GitLab 当前用户的活动或 MR，请检查 Token 权限；未使用全部仓库替代".into()); }
    let mut ids: Vec<_> = candidates.into_iter().collect();
    ids.sort_unstable();
    let mut projects = Vec::new();
    for id in ids {
        match api.request(&format!("/projects/{id}"), "GET", None).await {
            Ok(project) if !text(&project, "path_with_namespace").is_empty() => projects.push(project),
            Ok(_) => warnings.push(format!("GitLab 项目 {id} 缺少仓库路径，已跳过")),
            Err(e) => warnings.push(format!("GitLab 项目 {id} 不可读取：{e}")),
        }
    }
    Ok(projects)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn server(f: impl Fn(&str) -> Value + Send + Sync + 'static) -> (Api, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let api = Api::new(&format!("http://{}", listener.local_addr().unwrap()), "", "Token", "fixture").unwrap();
        let task = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = vec![0; 8192];
                let n = socket.read(&mut bytes).await.unwrap();
                let request = String::from_utf8_lossy(&bytes[..n]);
                assert!(request.starts_with("GET "));
                let route = request.split_whitespace().nth(1).unwrap();
                let body = f(route).to_string();
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
            }
        });
        (api, task)
    }

    #[tokio::test]
    async fn workbench_pages_aggregate_unique_products_without_catalog_scan() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let log = calls.clone();
        let (api, server) = server(move |route| {
            log.lock().unwrap().push(route.to_owned());
            if route.starts_with("/user?fields=bug") {
                assert!(route.contains("type=assignedTo&order=assignedDate_desc"));
                let rows = if route.contains("page=2") { json!([{"id":101,"product":"2","assignedTo":{"account":"alice"}}]) }
                else { json!((1..=100).map(|id|json!({"id":id,"product":1,"assignedTo":"alice"})).collect::<Vec<_>>()) };
                json!({"profile":{"account":"alice"},"bug":{"total":101,"bugs":rows}})
            } else if route.starts_with("/user?fields=story") {
                json!({"profile":{"account":"alice"},"story":{"total":2,"stories":[{"id":1,"product":2},{"id":2,"product":{"id":3}}]}})
            } else if route.starts_with("/products/") {
                let id: u64 = route.rsplit('/').next().unwrap().parse().unwrap();
                json!({"id":id,"name":format!("P{id}")})
            } else { panic!("Unexpected catalog request: {route}"); }
        }).await;
        let products = assigned_products(&api, "alice").await.unwrap();
        assert_eq!(products.len(), 3);
        assert_eq!(calls.lock().unwrap().iter().filter(|r| *r == "/products/2").count(), 1);
        server.abort();
    }

    #[tokio::test]
    async fn incompatible_workbench_and_wrong_identity_fail_without_fallback() {
        for response in [json!({"profile":{"account":"alice"}}), json!({"profile":{"account":"bob"},"bug":{"total":0,"bugs":[]}}), json!({"profile":{"account":"alice"},"bug":{"total":1,"bugs":[{"id":1,"product":2,"assignedTo":"bob"}]}})] {
            let (api, server) = server(move |route| { assert!(route.starts_with("/user?fields=bug")); response.clone() }).await;
            assert!(assigned_products(&api, "alice").await.is_err());
            server.abort();
        }
    }

    #[tokio::test]
    async fn gitlab_uses_token_identity_and_paginates_candidates_above_old_limit() {
        let (api, server) = server(|route| {
            if route == "/user" { json!({"id":77,"username":"gitlab-user"}) }
            else if route.starts_with("/users/77/events?") {
                assert!(route.contains("after=") && route.contains("sort=desc"));
                let range = if route.contains("page=2") { 101..102 } else { 1..101 };
                json!(range.map(|id|json!({"id":id,"project_id":id})).collect::<Vec<_>>())
            } else if route.starts_with("/merge_requests?") {
                assert!(route.contains("_id=77") && route.contains("updated_after="));
                json!([{"id":123,"project_id":1}])
            } else if route.starts_with("/projects/") {
                json!({"path_with_namespace":format!("g/{}",route.rsplit('/').next().unwrap())})
            } else { panic!("Unexpected global project scan: {route}"); }
        }).await;
        let mut warnings = Vec::new();
        assert_eq!(user_projects(&api, &mut warnings).await.unwrap().len(), 101);
        assert!(warnings.is_empty());
        server.abort();
    }
}
