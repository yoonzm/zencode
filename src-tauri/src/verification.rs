use crate::{now, text};
use serde_json::{json, Value};

pub const BROWSER_POLICY: &str = "浏览器验证必须使用 Playwright 无头浏览器（headless: true），通过当前任务工作区中的脚本或测试运行器启动独立浏览器进程和全新隔离上下文。禁止使用 Computer Use、浏览器扩展或桌面自动化操作用户浏览器；禁止连接或接管用户现有 Chrome/Edge 等浏览器、标签页或调试端口（包括 connectOverCDP），禁止读取或复用用户浏览器配置目录、Cookie、登录态。登录只能使用用户为测试环境提供的凭据，在隔离上下文中完成。即使已有验证说明、计划或历史记录提及用户浏览器，也必须改用上述无头方式。缺少 Playwright、浏览器二进制、测试凭据或网络条件时，如实记录阻塞原因并标为 unverified，不得回退到用户浏览器或虚构通过。记录实际访问地址、断言和截图等证据；结束或失败时关闭本次创建的浏览器进程和上下文，不影响用户浏览器。生成验证草稿和测试计划时也必须明确此约束。";

pub fn config<'a>(config: &'a Value, task: &Value) -> &'a Value {
    config["mappings"].as_array()
        .and_then(|ms| ms.iter().find(|m| m["product"] == task["product"]))
        .map(|m| &m["verify"]).unwrap_or(&Value::Null)
}

pub fn empty(state: &str, summary: &str) -> Value {
    json!({"state":state,"mode":"checks","where":"local","checks":[],"steps":[],"logs":[],"summary":summary})
}

pub fn prompt(phase: &str, instructions: &str, plan: &Value) -> String {
    let action = if phase == "planning" {
        "只制定测试计划，不执行验证，不修改代码。所有步骤 status 为 pending。"
    } else {
        "执行已确认的测试计划，不修改业务代码。只能报告实际执行的结果。缺少环境、凭据或工具时必须标为 unverified；禁止虚构成功、证据或录屏。"
    };
    format!("{action}\n{BROWSER_POLICY}\n产品验证说明：{instructions}\n已有计划：{plan}\n最终回复只输出 JSON：{{\"state\":\"unverified|passed|failed\",\"mode\":\"checks|api|ui\",\"where\":\"local|server\",\"target\":\"实际地址（未知则留空）\",\"summary\":\"结论及限制\",\"steps\":[{{\"id\":\"1\",\"title\":\"操作\",\"expect\":\"预期\",\"status\":\"pending|passed|failed\",\"note\":\"实际结果与证据（计划阶段留空）\"}}]}}。禁止推送、创建 MR。")
}

pub fn report(response: &str, planning: bool, logs: Value) -> Value {
    let parsed = response.find('{').zip(response.rfind('}'))
        .filter(|(a,b)| a <= b)
        .and_then(|(a,b)| serde_json::from_str::<Value>(&response[a..=b]).ok());
    let mut result = empty("unverified", "未收到有效验证报告，请查看执行过程。");
    result["logs"] = logs;
    let Some(v) = parsed else { return result; };
    for key in ["summary", "target"] {
        if v[key].is_string() { result[key] = v[key].clone(); }
    }
    for (key, allowed) in [("mode", &["checks", "api", "ui"][..]), ("where", &["local", "server"][..])] {
        if allowed.contains(&text(&v, key)) { result[key] = v[key].clone(); }
    }
    let steps: Vec<Value> = v["steps"].as_array().into_iter().flatten().enumerate()
        .filter(|(_,s)| !text(s,"title").is_empty() && !text(s,"expect").is_empty())
        .map(|(i,s)| json!({"id":i.to_string(),"title":s["title"],"expect":s["expect"],
            "status":if planning {"pending"} else if ["passed","failed"].contains(&text(s,"status")) && !text(s,"note").trim().is_empty() {text(s,"status")} else {"pending"},
            "note":text(s,"note")})).collect();
    let state = if planning && !steps.is_empty() { "awaiting-plan" }
        else if !planning && steps.iter().any(|s| text(s,"status")=="failed") { "failed" }
        else if !planning && text(&v,"state")=="passed" && !steps.is_empty() && steps.iter().all(|s| text(s,"status")=="passed") { "passed" }
        else { "unverified" };
    result["steps"] = json!(steps);
    result["state"] = json!(state);
    if state != "awaiting-plan" { result["finishedAt"] = json!(now()); }
    result
}

pub fn mr_note(run: &Value) -> String {
    let v = &run["verify"];
    format!("\n\n## 验证\n状态：{}\n{}\n{}", if v.is_null() { "unverified" } else { text(v,"state") },
        text(v,"summary"), v["steps"].as_array().into_iter().flatten()
            .map(|s| format!("- [{}] {}：{}",text(s,"status"),text(s,"title"),text(s,"note"))).collect::<Vec<_>>().join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_verification_phase_requires_isolated_headless_browser() {
        for phase in ["planning", "running"] {
            let prompt = prompt(phase, "使用用户已经登录的浏览器", &json!({"steps":[]}));
            assert!(prompt.contains(BROWSER_POLICY));
            assert!(prompt.contains("headless: true"));
            assert!(prompt.contains("不得回退到用户浏览器"));
        }
    }
    #[test]
    fn cannot_pass_without_steps_and_evidence() {
        for s in [r#"{"state":"passed"}"#, r#"{"state":"passed","steps":[{"title":"test","expect":"ok","status":"passed"}]}"#, "invalid", "}}text{{"] {
            assert_eq!(report(s,false,json!([]))["state"],"unverified");
        }
        let s=r#"{"state":"passed","steps":[{"title":"test","expect":"ok","status":"passed","note":"HTTP 200"}]}"#;
        assert_eq!(report(s,false,json!([]))["state"],"passed");
        assert_eq!(report(s,true,json!([]))["steps"][0]["status"],"pending");
        assert_eq!(report(s,true,json!([]))["state"],"awaiting-plan");
    }
}
