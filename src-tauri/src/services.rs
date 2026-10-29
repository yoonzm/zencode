use crate::{text, Result};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;
pub fn local_path(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        return PathBuf::from(
            std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_default(),
        )
        .join(rest);
    }
    PathBuf::from(raw)
}
pub fn executable(file: &str, args: &[String]) -> Result<Command> {
    #[cfg(target_os = "macos")]
    let mac_path = {
        let mut dirs = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .collect::<Vec<_>>();
        dirs.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(&home).join(".local/bin"));
            dirs.push(PathBuf::from(home).join(".cargo/bin"));
        }
        std::env::join_paths(dirs).map_err(|e| e.to_string())?
    };
    #[cfg(windows)]
    if file == "codex" || file.to_lowercase().ends_with(".cmd") {
        let candidate = if file.ends_with(".cmd") {
            Some(PathBuf::from(file))
        } else {
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                .map(|p| p.join("codex.cmd"))
                .find(|p| p.is_file())
        };
        if let Some(wrapper) = candidate {
            let script = wrapper
                .parent()
                .ok_or("无效 Codex 路径")?
                .join("node_modules/@openai/codex/bin/codex.js");
            if !script.is_file() {
                return Err("无法解析 CLI 包装脚本，请选择 codex.exe".into());
            }
            let mut command = Command::new("node");
            command.arg(script).args(args);
            command.creation_flags(0x08000000);
            return Ok(command);
        }
    }
    let mut command = Command::new(file);
    command.args(args);
    #[cfg(target_os = "macos")]
    command.env("PATH", mac_path);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    Ok(command)
}
pub async fn command(file: &str, args: &[&str], cwd: Option<&Path>) -> Result<String> {
    let mut cmd = executable(
        file,
        &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
    )?;
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(120), cmd.output())
        .await
        .map_err(|_| format!("{file} 命令超时"))?
        .map_err(|e| format!("{file}: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "{file} 退出 {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}
pub fn base_url(raw: &str) -> Result<String> {
    let u = url::Url::parse(raw).map_err(|_| "请输入有效服务地址")?;
    if !["https", "http"].contains(&u.scheme())
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err("请输入无凭据、查询或片段的 HTTP(S) 服务地址".into());
    }
    Ok(u.as_str().trim_end_matches('/').to_string())
}
#[derive(Clone)]
pub struct Api {
    pub base: String,
    pub header: String,
    pub secret: String,
    client: reqwest::Client,
}
fn connection_error(error: reqwest::Error) -> String {
    // Inspect causes without exposing URLs, headers or credentials in the message.
    let mut cause = std::error::Error::source(&error);
    while let Some(source) = cause {
        let message = source.to_string().to_lowercase();
        if message.contains("certificate") || message.contains("unknownissuer") {
            return "证书验证失败。请检查服务证书或导入公司根证书，也可在上方「高级」里为这个连接跳过证书验证。".into();
        }
        cause = source.source();
    }
    format!("服务连接失败：{}", error.without_url())
}
impl Api {
    pub fn new(base: &str, prefix: &str, header: &str, secret: &str) -> Result<Self> {
        Self::with_tls(base, prefix, header, secret, false)
    }
    pub fn with_tls(
        base: &str,
        prefix: &str,
        header: &str,
        secret: &str,
        insecure_tls: bool,
    ) -> Result<Self> {
        Ok(Self {
            base: base_url(base)? + prefix,
            header: header.into(),
            secret: secret.into(),
            client: reqwest::Client::builder()
                .danger_accept_invalid_certs(insecure_tls)
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.to_string())?,
        })
    }
    pub async fn request(&self, route: &str, method: &str, body: Option<Value>) -> Result<Value> {
        let method = method
            .parse::<reqwest::Method>()
            .map_err(|e| e.to_string())?;
        let mut request = self
            .client
            .request(method, format!("{}{}", self.base, route));
        if !self.secret.is_empty() {
            request = request.header(&self.header, &self.secret);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(connection_error)?;
        if !response.status().is_success() {
            return Err(format!(
                "服务请求失败 HTTP {} ({})",
                response.status(),
                route.split('?').next().unwrap_or("")
            ));
        }
        if response.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(json!({}));
        }
        let status = response.status();
        let path = format!("{}{}", url::Url::parse(&self.base).map(|u| u.path().to_owned()).unwrap_or_default(), route.split('?').next().unwrap_or(""));
        let body = response.bytes().await
            .map_err(|_| format!("读取服务响应失败（HTTP {status}，{path}）"))?;
        if body.iter().all(u8::is_ascii_whitespace) {
            return Err(format!("服务返回空响应（HTTP {status}，{path}），当前接口可能不受支持"));
        }
        serde_json::from_slice(&body)
            .map_err(|_| format!("服务返回非 JSON 或无效 JSON（HTTP {status}，{path}）"))
    }
    /// Modern ZenTao maps /actions/comment to action::comment without changing object state.
    /// Only an absent/unsupported endpoint permits the legacy v1 fallback; auth/server failures do not.
    pub async fn comment(&self, kind: &str, id: u64, link: &str) -> Result<()> {
        if !["bug", "story"].contains(&kind) {
            return Err("不支持的评论对象".into());
        }
        let mut v2 = self.clone();
        v2.base = format!(
            "{}/api.php/v2",
            self.base
                .strip_suffix("/api.php/v1")
                .ok_or("无效禅道 API 路径")?
        );
        let result = v2
            .request(
                &format!("/actions/comment?objectType={kind}&objectID={id}"),
                "POST",
                Some(json!({"comment":format!("ZenCode MR: {link}")})),
            )
            .await;
        match result {
            Ok(_) => Ok(()),
            Err(e) if e.contains("HTTP 404") || e.contains("HTTP 405") => {
                self.request("/comments","POST",Some(json!({"objectType":kind,"objectID":id,"comment":format!("ZenCode MR: {link}")}))).await?;
                Ok(())
            }
            Err(e) => Err(e),
        }
    }
    pub async fn download(&self, route: &str) -> Result<Vec<u8>> {
        let mut response = self
            .client
            .get(format!("{}{}", self.base, route))
            .header(&self.header, &self.secret)
            .send()
            .await
            .map_err(connection_error)?;
        if !response.status().is_success() {
            return Err(format!("附件下载失败 HTTP {}", response.status()));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        if content_type.contains("json") || content_type.contains("text/html") {
            return Err("附件接口返回了网页或 JSON，当前服务器版本需使用禅道页面下载".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| e.without_url().to_string())?
        {
            if bytes.len() + chunk.len() > 50 * 1024 * 1024 {
                return Err("附件超过 50 MB 下载限制，请在禅道下载".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
    pub async fn gitlab_pages(&self, route: &str) -> Result<Vec<Value>> {
        let mut rows = Vec::new();
        for page in 1..=100 {
            let data = self.request(&format!("{route}{}per_page=100&page={page}", if route.contains('?') { '&' } else { '?' }), "GET", None).await?;
            let items = data.as_array().ok_or("GitLab 列表响应无效")?;
            rows.extend(items.iter().cloned());
            if items.len() < 100 { return Ok(rows); }
        }
        Err("GitLab 列表超过 100 页".into())
    }
    pub async fn pages(&self, route: &str, key: &str) -> Result<Vec<Value>> {
        let mut rows = vec![];
        for page in 1..=100 {
            let data = self
                .request(
                    &format!(
                        "{route}{}page={page}&limit=100",
                        if route.contains('?') { '&' } else { '?' }
                    ),
                    "GET",
                    None,
                )
                .await?;
            let items = data[key]
                .as_array()
                .ok_or_else(|| format!("响应缺少 {key} 数组，请确认 REST API v1 兼容性"))?;
            rows.extend(items.iter().cloned());
            if items.len() < 100
                || data["total"]
                    .as_u64()
                    .is_some_and(|n| rows.len() >= n as usize)
            {
                return Ok(rows);
            }
        }
        Err("同步超过 100 页，请缩小产品范围".into())
    }
}
pub async fn zentao(c: &Value) -> Result<Api> {
    let mut api = Api::with_tls(
        text(c, "baseUrl"),
        "/api.php/v1",
        "Token",
        text(c, "secret"),
        c["insecureTls"].as_bool().unwrap_or(false),
    )?;
    if text(c, "auth") == "password" {
        api.secret.clear();
        let result = api
            .request(
                "/tokens",
                "POST",
                Some(json!({"account":text(c,"account"),"password":text(c,"secret")})),
            )
            .await?;
        api.secret = text(&result, "token").into();
    }
    if api.secret.is_empty() {
        return Err("禅道 Token 为空".into());
    }
    Ok(api)
}
pub fn gitlab(c: &Value) -> Result<Api> {
    Api::with_tls(
        text(c, "baseUrl"),
        "/api/v4",
        "PRIVATE-TOKEN",
        text(c, "token"),
        c["insecureTls"].as_bool().unwrap_or(false),
    )
}
pub fn empty_run() -> Value {
    json!({"state":"idle","model":"Codex · 标准","events":[],"files":[],"queue":[],"scriptId":"","patchKeys":{},"end":"review","viewed":[]})
}
fn name(v: &Value) -> String {
    v.as_str().map(str::to_owned).unwrap_or_else(|| {
        ["realname", "name", "account"]
            .iter()
            .find_map(|k| v[k].as_str())
            .unwrap_or("")
            .to_owned()
    })
}
fn date(v: &Value) -> i64 {
    if let Some(date) = v
        .as_str()
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
    {
        return date
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
    }
    if let Some(date) = v
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    {
        return date.timestamp_millis();
    }
    v.as_str()
        .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok())
        .map(|d| d.and_utc().timestamp_millis())
        .unwrap_or_else(crate::now)
}
pub fn task(
    row: &Value,
    kind: &str,
    product: &Value,
    mapping: &Value,
    account: &str,
) -> Result<Value> {
    let id = row["id"]
        .as_u64()
        .or_else(|| row["id"].as_str()?.parse().ok())
        .ok_or("无效禅道任务 ID")?;
    if text(row, "title").is_empty() {
        return Err("禅道返回了无标题的任务，无法同步".into());
    }
    let assignee = row["assignedTo"]["account"]
        .as_str()
        .or_else(|| row["assignedTo"].as_str())
        .unwrap_or("");
    Ok(
        json!({"id":format!("{kind}-{id}"),"no":id,"kind":kind,"title":row["title"],"priority":row["pri"].as_u64().unwrap_or(3).clamp(1,4),"severity":row["severity"],"ztStatus":row["status"],"product":product["name"],"module":row["moduleTitle"].as_str().map(str::to_owned).unwrap_or_else(||name(&row["module"])),"moduleKey":name(&row["module"]),"sprint":name(&row["execution"]),"assignee":if assignee==account {"me".into()}else{name(&row["assignedTo"])},"reporter":name(&row["openedBy"]),"createdAt":date(&row["openedDate"]),"updatedAt":date(&row["lastEditedDate"]),"deadline":if text(row,"deadline").is_empty()||text(row,"deadline")=="0000-00-00"{Value::Null}else{json!(date(&row["deadline"]))},"repoId":text(mapping,"repo"),"labels":[],"description":[{"type":"p","text":row["steps"].as_str().or_else(||row["spec"].as_str()).unwrap_or("")}],"attachments":attachments(row),"history":history(row),"run":empty_run()}),
    )
}
fn values(v: &Value) -> Vec<&Value> {
    if let Some(a) = v.as_array() {
        a.iter().collect()
    } else if let Some(o) = v.as_object() {
        o.values().collect()
    } else {
        vec![]
    }
}
fn attachments(row: &Value) -> Vec<Value> {
    values(&row["files"]).iter().filter_map(|file|{let id=file["id"].as_u64().or_else(||file["id"].as_str()?.parse().ok())?;Some(json!({"id":id,"name":file["title"],"size":format!("{} B",file["size"].as_u64().unwrap_or(0))}))}).collect()
}
fn history(row: &Value) -> Vec<Value> {
    values(&row["actions"]).iter().map(|a|json!({"at":date(&a["date"]),"who":name(&a["actor"]),"text":format!("{} {}",text(a,"action"),text(a,"comment"))})).collect()
}
pub async fn sync(config: &Value) -> Result<(Vec<Value>, Vec<String>)> {
    let api = zentao(&config["zentao"]).await?;
    let products = api.pages("/products", "products").await?;
    let mut tasks = vec![];
    for product in &products {
        let mapping = config["mappings"]
            .as_array()
            .and_then(|ms| ms.iter().find(|m| m["product"] == product["name"]))
            .cloned()
            .unwrap_or(Value::Null);
        if mapping.is_null() {
            continue;
        }
        for (kind, plural) in [("bug", "bugs"), ("story", "stories")] {
            let mut route = format!("/products/{}/{plural}", product["id"]);
            if kind == "story" {
                // Include stories in every ZenTao product branch of this mapped product.
                route.push_str("?branch=all");
            }
            let rows = api.pages(&route, plural).await?;
            for row in rows {
                let assignee = row["assignedTo"]["account"]
                    .as_str()
                    .or_else(|| row["assignedTo"].as_str())
                    .unwrap_or("");
                if text(&config["zentao"], "scope") == "mine"
                    && assignee != text(&config["zentao"], "account")
                {
                    continue;
                }
                let detail = api
                    .request(&format!("/{plural}/{}", row["id"]), "GET", None)
                    .await?;
                let mut merged = row.clone();
                if let (Some(a), Some(b)) = (merged.as_object_mut(), detail.as_object()) {
                    a.extend(b.clone());
                }
                tasks.push(task(
                    &merged,
                    kind,
                    product,
                    &mapping,
                    text(&config["zentao"], "account"),
                )?);
            }
        }
    }
    Ok((
        tasks,
        products
            .iter()
            .map(|p| text(p, "name").to_owned())
            .collect(),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urls_reject_credentials_and_schemes() {
        assert!(base_url("file:///tmp/a").is_err());
        assert!(base_url("https://u:p@test.com").is_err());
        assert_eq!(
            base_url("https://test.com/zentao/").unwrap(),
            "https://test.com/zentao"
        );
    }
    #[test]
    fn normalization_uses_real_identity() {
        let row = json!({"id":42,"title":"Fix","assignedTo":{"account":"a","realname":"Alice"}});
        let t = task(&row, "bug", &json!({"name":"Product"}), &Value::Null, "a").unwrap();
        assert_eq!(t["assignee"], "me");
        assert_eq!(t["run"]["state"], "idle");
        assert!(t["attachments"].as_array().unwrap().is_empty());
    }
}
