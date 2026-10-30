use crate::{now, text};
use serde_json::{json, Value};

pub fn browser_policy(root: &std::path::Path) -> crate::Result<String> {
    use sha2::{Digest, Sha256};
    let source = include_str!("playwright-runtime.cjs");
    let directory = root.join("verification-runtime");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let script = directory.join(format!("runner-{:x}.cjs", Sha256::digest(source.as_bytes())));
    if !script.exists() {
        let temp = directory.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temp, source).map_err(|e| e.to_string())?;
        if let Err(e) = std::fs::rename(&temp, &script) {
            let _ = std::fs::remove_file(&temp);
            if !script.exists() { return Err(e.to_string()); }
        }
    }
    Ok(format!("{BROWSER_POLICY}\n共享浏览器运行器：{}。计划/草稿阶段只描述步骤，不安装。实际 UI 验证前必须执行 node <运行器绝对路径>：自动检查、首次安装固定版本 Playwright 和 Chromium，并验证无头启动；其他任务复用同一目录，并发安装自动等待。不要因为工作区无法解析 Playwright 就停止，也不要在业务仓库、worktree 或全局重复安装。执行任务脚本使用 node <运行器绝对路径> <任务脚本绝对路径> [参数]；脚本使用 CommonJS .cjs 和 require('playwright')，或通过 process.env.ZENCODE_PLAYWRIGHT_MODULE 加载共享包，ESM 不依赖 NODE_PATH。运行器设置共享浏览器路径；每个任务仍创建独立上下文，证据存入任务目录。允许为验证准备此公共工具目录，但必须遵守宿主实际权限，权限或网络阻塞时记录真实失败原因；安装或启动失败才标为 unverified，不得虚构通过。", serde_json::to_string(&script).map_err(|e| e.to_string())?))
}

pub const BROWSER_POLICY: &str = "浏览器验证必须使用 Playwright 无头浏览器（headless: true），通过当前任务工作区中的脚本或测试运行器启动独立浏览器进程和全新隔离上下文。禁止使用 Computer Use、浏览器扩展或桌面自动化操作用户浏览器；禁止连接或接管用户现有 Chrome/Edge 等浏览器、标签页或调试端口（包括 connectOverCDP），禁止读取或复用用户浏览器配置目录、Cookie、登录态。登录只能使用用户为测试环境提供的凭据，在隔离上下文中完成。即使已有验证说明、计划或历史记录提及用户浏览器，也必须改用上述无头方式。缺少 Playwright 或浏览器二进制时先使用共享运行器自动安装；安装失败、缺少测试凭据或网络条件时，如实记录阻塞原因并标为 unverified，不得回退到用户浏览器或虚构通过。记录实际访问地址、断言和截图等证据；结束或失败时关闭本次创建的浏览器进程和上下文，不影响用户浏览器。生成验证草稿和测试计划时也必须明确此约束。";

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
    fn shared_runner_is_stable_across_sessions() {
        let root = tempfile::tempdir().unwrap();
        let first = browser_policy(root.path()).unwrap();
        assert_eq!(first, browser_policy(root.path()).unwrap());
        assert!(first.contains("require('playwright')"));
        let files: Vec<_> = std::fs::read_dir(root.path().join("verification-runtime")).unwrap().collect();
        assert_eq!(files.len(), 1);
        assert_eq!(std::fs::read_to_string(files[0].as_ref().unwrap().path()).unwrap(), include_str!("playwright-runtime.cjs"));
    }
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
