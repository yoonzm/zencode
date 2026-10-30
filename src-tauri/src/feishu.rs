use crate::{text, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::time::Duration;

fn webhook(raw: &str) -> Result<url::Url> {
    let u = url::Url::parse(raw.trim()).map_err(|_| "飞书 Webhook 地址格式错误")?;
    let token = u.path().strip_prefix("/open-apis/bot/v2/hook/").unwrap_or("");
    if u.scheme() != "https" || !matches!(u.host_str(), Some("open.feishu.cn" | "open.larksuite.com"))
        || !u.username().is_empty() || u.password().is_some() || u.port().is_some()
        || u.query().is_some() || u.fragment().is_some() || token.len() < 8
        || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("请填写完整的飞书或 Lark 自定义机器人 Webhook 地址".into());
    }
    Ok(u)
}

fn signature(secret: &str, timestamp: i64) -> String {
    let key = format!("{timestamp}\n{secret}");
    let mac = Hmac::<Sha256>::new_from_slice(key.as_bytes()).expect("HMAC accepts any key length");
    STANDARD.encode(mac.finalize().into_bytes())
}

pub(crate) fn card(title: &str, tone: &str, lines: Vec<(&str, String)>) -> Value {
    let mut elements: Vec<Value> = lines.into_iter().map(|(label, value)| json!({
        "tag":"div", "text":{"tag":"plain_text","content":format!("{label}：{}", value.chars().take(600).collect::<String>())}
    })).collect();
    elements.push(json!({"tag":"note","elements":[{"tag":"plain_text","content":"回到 ZenCode 按任务编号查看任务"}]}));
    json!({"msg_type":"interactive","card":{"header":{"title":{"tag":"plain_text","content":format!("ZenCode · {title}")},"template":tone},"elements":elements}})
}

pub fn test_card() -> Value {
    card("测试消息", "blue", vec![("状态", "飞书通知连接成功".into())])
}

// Only transitions generate messages; streaming output and diff refreshes do not.
pub fn transition(old: &Value, task: &Value, prefs: &Value) -> Option<Value> {
    if prefs["enabled"].as_bool() != Some(true) { return None; }
    let run = &task["run"];
    let state = text(run, "state");
    if state == text(&old["run"], "state") { return None; }
    let (title, tone, group) = match state {
        "waiting" if text(&run["verify"], "state") == "awaiting-plan" => ("测试计划等你确认", "orange", "attention"),
        "waiting" => ("需要你审批", "orange", "attention"),
        "failed" => ("执行失败", "red", "attention"),
        "review" if text(&run["verify"], "state") == "failed" => ("验证未通过", "red", "attention"),
        "review" if text(&run["verify"], "state") == "passed" => ("任务完成，验证通过", "green", "result"),
        "review" => ("任务完成，未验证", "green", "result"),
        "done" if run["mr"]["url"].as_str().is_some_and(|s| !s.is_empty()) => ("已创建 Merge Request", "green", "result"),
        _ => return None,
    };
    if prefs[group].as_bool() == Some(false) { return None; }
    let prefix = if task["manual"].as_bool() == Some(true) { "N" } else if text(task, "kind") == "bug" { "BUG #" } else { "需求 #" };
    let mut lines = vec![
        ("任务", format!("{prefix}{} {}", task["no"], text(task,"title"))),
        ("产品", text(task,"product").to_owned()),
    ];
    if state == "review" || state == "failed" {
        lines.push(("改动", format!("{} 个文件", run["files"].as_array().map_or(0, Vec::len))));
    }
    if state == "done" {
        lines.push(("分支", text(run,"branch").to_owned()));
        lines.push(("链接", text(&run["mr"],"url").to_owned()));
    }
    // Do not include commands, model output, requirement descriptions or code in group messages.
    Some(card(title, tone, lines))
}

fn check_response(status: reqwest::StatusCode, body: &Value) -> Result<()> {
    if !status.is_success() { return Err(format!("飞书服务返回 HTTP {}", status.as_u16())); }
    if body["code"].as_i64().or_else(|| body["StatusCode"].as_i64()) != Some(0) {
        return Err(format!("飞书拒绝消息（错误码 {}），请检查机器人关键词、签名和 IP 白名单设置", body["code"].as_i64().or_else(|| body["StatusCode"].as_i64()).map_or("未知".into(), |v| v.to_string())));
    }
    Ok(())
}

pub async fn send(prefs: &Value, mut body: Value) -> Result<()> {
    let url = webhook(text(prefs, "webhook"))?;
    let secret = text(prefs, "secret");
    if !secret.is_empty() {
        let timestamp = chrono::Utc::now().timestamp();
        body["timestamp"] = json!(timestamp.to_string());
        body["sign"] = json!(signature(secret, timestamp));
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "无法创建飞书连接")?;
    // reqwest errors may contain the credential-bearing URL: never surface them verbatim.
    let response = client.post(url).json(&body).send().await.map_err(|_| "飞书连接失败，请检查网络和机器人配置")?;
    let status = response.status();
    if !status.is_success() { return check_response(status, &Value::Null); }
    let result: Value = response.json().await.map_err(|_| "飞书返回了无效响应")?;
    check_response(status, &result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signature_matches_independent_hmac_fixture() {
        assert_eq!(signature("example-secret", 1700000000), "Gs3YRutIJpVN2FvEXKXHU6bEj2pVdSriQ0niig9EbUk=");
    }
    #[test]
    fn validates_destination_and_response() {
        assert!(webhook("https://open.feishu.cn/open-apis/bot/v2/hook/12345678").is_ok());
        assert!(webhook("https://open.larksuite.com/open-apis/bot/v2/hook/12345678").is_ok());
        for u in ["http://open.feishu.cn/open-apis/bot/v2/hook/12345678", "https://evil.test/open-apis/bot/v2/hook/12345678", "https://open.feishu.cn/open-apis/bot/v2/hook/12345678?secret=x"] { assert!(webhook(u).is_err()); }
        assert!(check_response(reqwest::StatusCode::OK, &json!({"code":0})).is_ok());
        assert!(check_response(reqwest::StatusCode::OK, &json!({"code":19021})).is_err());
        assert!(check_response(reqwest::StatusCode::OK, &json!({})).is_err());
        assert!(check_response(reqwest::StatusCode::BAD_REQUEST, &json!({"code":0})).is_err());
    }
    #[test]
    fn sends_only_selected_transitions_without_private_content() {
        let prefs = json!({"enabled":true,"attention":true,"result":false});
        let old = json!({"run":{"state":"running"}});
        let mut task = json!({"no":12,"kind":"bug","title":"Example","product":"P","description":"PRIVATE","run":{"state":"review","verify":{"state":"failed","summary":"PRIVATE"},"files":[]}});
        let msg = transition(&old, &task, &prefs).unwrap().to_string();
        assert!(msg.contains("验证未通过")); assert!(!msg.contains("PRIVATE"));
        assert!(transition(&task, &task, &prefs).is_none());
        task["run"]["verify"]["state"] = json!("passed");
        assert!(transition(&old, &task, &prefs).is_none());
        assert!(transition(&old, &task, &json!({"enabled":false})).is_none());
        task["run"]["state"] = json!("waiting");
        task["run"]["verify"]["state"] = json!("awaiting-plan");
        assert!(transition(&old, &task, &prefs).unwrap().to_string().contains("测试计划"));
        task["run"]["verify"] = Value::Null;
        assert!(transition(&old, &task, &prefs).unwrap().to_string().contains("需要你审批"));
        task["run"]["state"] = json!("failed");
        assert!(transition(&old, &task, &prefs).unwrap().to_string().contains("执行失败"));
        task["run"]["state"] = json!("done");
        task["run"]["mr"] = json!({"iid":1,"url":"https://gitlab.example/team/app/-/merge_requests/1"});
        // The runtime stores MR metadata before marking the run done.
        let mut pending = task.clone();
        pending["run"]["state"] = json!("review");
        assert!(transition(&pending, &task, &json!({"enabled":true,"result":true})).unwrap().to_string().contains("Merge Request"));
        assert!(transition(&task, &task, &json!({"enabled":true})).is_none());
    }
}
