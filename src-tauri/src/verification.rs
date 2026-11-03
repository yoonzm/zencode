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

/// Empty projectPrompt intentionally overrides the legacy verification text.
pub fn project_prompt(mapping: &Value) -> &str {
    mapping["projectPrompt"].as_str().unwrap_or_else(|| text(&mapping["verify"], "prompt"))
}

pub fn instructions<'a>(config: &'a Value, task: &Value) -> &'a str {
    config["mappings"].as_array()
        .and_then(|ms| ms.iter().find(|m| m["product"] == task["product"]))
        .map(project_prompt).unwrap_or("")
}

pub fn project_context(instructions: &str) -> String {
    format!("项目专有提示词（用户配置，适用于任务分析、开发、自检、验证和继续任务；按当前阶段选用相关约定，不要将开发操作带入只读或验证阶段。阶段限制、浏览器隔离和应用操作权限仍须遵守）：\n{instructions}")
}

pub fn empty(state: &str, summary: &str) -> Value {
    json!({"state":state,"mode":"checks","where":"local","checks":[],"steps":[],"logs":[],"summary":summary})
}

pub fn progress_prompt(path: &std::path::Path) -> String {
    format!("\n实时验证进度：本轮专用进度文件为 {}。开始验证前创建目录和文件；每个步骤开始前、断言完成或失败后，立即原子写入完整 JSON 快照（先写同目录临时文件再替换），长步骤在取得中间结果时也更新 note。步骤 id 必须沿用已有计划，不能重编号。格式：{{\"target\":\"当前实际验证地址，未知留空\",\"where\":\"local|server\",\"summary\":\"当前正在做什么\",\"steps\":[{{\"id\":\"计划中的原 id\",\"status\":\"pending|running|passed|failed\",\"note\":\"当前进展或实际断言证据\"}}]}}。未执行不得标 passed，passed/failed 必须给出实际证据 note；开始时标 running，结束时标 passed/failed。让测试脚本在步骤之间直接写入此文件，不能等整条长命令结束才上报。确定或变更地址后立即更新 target。进度快照不替代最终 JSON 报告，最终报告仍按要求输出。", serde_json::to_string(path).unwrap_or_default())
}

/// A missing, incomplete or oversized snapshot must not interrupt the actual test.
pub fn read_progress(cwd: &std::path::Path, path: &std::path::Path) -> Option<Value> {
    use std::io::Read;
    let canonical = path.canonicalize().ok()?;
    if !canonical.starts_with(cwd.canonicalize().ok()?) { return None; }
    let mut bytes = Vec::new();
    std::fs::File::open(canonical).ok()?.take(65_537).read_to_end(&mut bytes).ok()?;
    if bytes.len() > 65_536 { return None; }
    serde_json::from_slice(&bytes).ok()
}

/// Progress can update known steps, but only the final report can finish verification.
pub fn apply_progress(verify: &mut Value, snapshot: &Value) -> bool {
    if text(verify, "state") != "running" || !snapshot.is_object() { return false; }
    let before = verify.clone();
    for key in ["target", "summary"] {
        if let Some(value) = snapshot[key].as_str().filter(|v| !v.trim().is_empty()) {
            verify[key] = json!(value);
        }
    }
    if ["local", "server"].contains(&text(snapshot, "where")) { verify["where"] = snapshot["where"].clone(); }
    if let Some(steps) = verify["steps"].as_array_mut() {
        for update in snapshot["steps"].as_array().into_iter().flatten() {
            let Some(id) = update["id"].as_str() else { continue; };
            let Some(step) = steps.iter_mut().find(|s| text(s, "id") == id) else { continue; };
            let status = text(update, "status");
            if !["pending", "running", "passed", "failed"].contains(&status) { continue; }
            if ["passed", "failed"].contains(&status) && text(update, "note").trim().is_empty() { continue; }
            step["status"] = json!(status);
            if update["note"].is_string() { step["note"] = update["note"].clone(); }
        }
    }
    *verify != before
}

pub fn interrupt(verify: &mut Value, reason: &str) {
    verify["state"] = json!("unverified");
    verify["summary"] = json!(reason);
    verify["finishedAt"] = json!(now());
    for step in verify["steps"].as_array_mut().into_iter().flatten() {
        if text(step, "status") == "running" {
            step["status"] = json!("pending");
            step["note"] = json!(format!("执行已中断：{reason}"));
        }
    }
}

pub fn prompt(phase: &str, instructions: &str, plan: &Value) -> String {
    let screenshot_policy = "截图默认精简：只保留能证明关键断言、最终结果或失败现场的真实截图；相同页面和状态不重复截图，不为每次点击、输入、加载或中间步骤截图。通常保留 1–3 张关键截图即可；多个独立失败或用户明确要求时按需增加，不得为了数量限制遗漏关键失败证据。计划阶段也应按此原则安排截图。";
    let action = if phase == "planning" {
        "只制定测试计划，不执行验证，不修改代码。结合项目专有提示词、任务要求、本次实际改动与已有自检结果，判断是否需要额外验证以及验证范围；提示词留空时依据仓库实际资料判断，不因未配置而跳过。只使用当前阶段相关的环境和测试约定。需要验证时生成最小充分的步骤，所有步骤 status 为 pending，verificationRequired 为 true。无需额外验证时 verificationRequired 为 false、state 为 unverified、steps 为空数组，summary 必须说明具体原因，不得声称验证通过。缺少环境、凭据、工具或无法判断不属于无需验证，应如实报告阻塞并保持 unverified。"
    } else {
        "执行已确认的测试计划，不修改业务代码。只能报告实际执行的结果。缺少环境、凭据或工具时必须标为 unverified；禁止虚构成功、证据或录屏。所有验证截图、日志、临时脚本统一存入任务工作区的 .verification/ 目录，不得加入 Git 暂存区或提交。UI 验证在关键步骤和失败处保存真实 PNG 截图。最终 JSON 增加 shots 数组，每项包含 path（工作区相对路径）、label（截图说明）、failed（是否未达预期）；只列出实际生成的截图，没有截图时返回空数组。"
    };
    format!("{action}\n{BROWSER_POLICY}\n{screenshot_policy}\n{}\n已有计划：{plan}\n最终回复只输出 JSON（计划阶段增加 verificationRequired 布尔值）：{{\"state\":\"unverified|passed|failed\",\"mode\":\"checks|api|ui\",\"where\":\"local|server\",\"target\":\"实际地址（未知则留空）\",\"summary\":\"结论及限制\",\"steps\":[{{\"id\":\"1\",\"title\":\"操作\",\"expect\":\"预期\",\"status\":\"pending|passed|failed\",\"note\":\"实际结果与证据（计划阶段留空）\"}}]}}。禁止推送、创建 MR。", project_context(instructions))
}

pub fn report(response: &str, planning: bool, logs: Value) -> Value {
    let parsed = response.find('{').zip(response.rfind('}'))
        .filter(|(a,b)| a <= b)
        .and_then(|(a,b)| serde_json::from_str::<Value>(&response[a..=b]).ok());
    let mut result = empty("unverified", "未收到有效验证报告，请查看执行过程。");
    result["logs"] = logs;
    let Some(v) = parsed else { return result; };
    if !planning {
        result["shots"] = json!(v["shots"].as_array().into_iter().flatten()
            .filter(|s| !text(s, "path").is_empty())
            .map(|s| json!({"path":text(s,"path"),"label":text(s,"label"),"failed":s["failed"] == true}))
            .collect::<Vec<_>>());
    }
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
    let unnecessary = planning && v["verificationRequired"] == false && v["steps"].as_array().is_some_and(|s| s.is_empty()) && !text(&v,"summary").trim().is_empty();
    if unnecessary { result["verificationRequired"] = json!(false); }
    let state = if planning && !unnecessary && !steps.is_empty() { "awaiting-plan" }
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
    fn progress_updates_only_known_steps_with_evidence_and_never_finishes_run() {
        let mut verify = json!({"state":"running","target":"","summary":"start","steps":[{"id":"0","title":"check","expect":"ok","status":"pending"},{"id":"1","title":"next","expect":"ok","status":"pending"}]});
        assert!(apply_progress(&mut verify, &json!({"state":"passed","target":"http://localhost:9000/","where":"local","steps":[{"id":"0","status":"running","note":"page loading"},{"id":"fake","status":"passed","note":"fake"}]})));
        assert_eq!(verify["state"],"running");
        assert_eq!(verify["steps"][0]["status"],"running");
        assert_eq!(verify["steps"].as_array().unwrap().len(),2);
        assert!(!apply_progress(&mut verify,&json!({"steps":[{"id":"0","status":"passed"},{"id":"1","status":"invalid","note":"bad"}]})));
        let result=json!({"summary":"first assertion passed","steps":[{"id":"0","status":"passed","note":"HTTP 200"},{"id":"1","status":"running","note":"checking UI"}]});
        assert!(apply_progress(&mut verify,&result));
        assert!(!apply_progress(&mut verify,&result));
        interrupt(&mut verify,"cancelled");
        assert_eq!(verify["state"],"unverified");
        assert_eq!(verify["steps"][0]["status"],"passed");
        assert_eq!(verify["steps"][1]["status"],"pending");
        assert!(!apply_progress(&mut verify,&result));
    }

    #[test]
    fn progress_reader_handles_partial_oversized_and_outside_files() {
        let root=tempfile::tempdir().unwrap();
        let path=root.path().join("progress.json");
        assert!(read_progress(root.path(),&path).is_none());
        for contents in ["{", &" ".repeat(65_537)] {
            std::fs::write(&path,contents).unwrap();
            assert!(read_progress(root.path(),&path).is_none());
        }
        std::fs::write(&path,r#"{"steps":[]}"#).unwrap();
        assert_eq!(read_progress(root.path(),&path).unwrap(),json!({"steps":[]}));
        let outside=tempfile::tempdir().unwrap();
        assert!(read_progress(outside.path(),&path).is_none());
        let prompt=progress_prompt(&path);
        assert!(prompt.contains("每个步骤开始前"));
        assert!(prompt.contains("不能等整条长命令结束"));
        assert!(prompt.contains("不能重编号"));
    }
    #[test]
    fn project_prompt_compatibility_and_product_scope() {
        let config = json!({"mappings":[
            {"product":"P","verify":{"enabled":false,"prompt":"legacy rules"}},
            {"product":"Q","projectPrompt":"Q rules"},
            {"product":"R","projectPrompt":"","verify":{"prompt":"stale"}}
        ]});
        assert_eq!(instructions(&config,&json!({"product":"P"})),"legacy rules");
        assert_eq!(instructions(&config,&json!({"product":"Q"})),"Q rules");
        assert_eq!(instructions(&config,&json!({"product":"R"})),"");
        assert_eq!(instructions(&config,&json!({"product":"missing"})),"");
    }

    #[test]
    fn no_verification_decision_never_reports_passed() {
        let decision = report(r#"{"verificationRequired":false,"state":"passed","summary":"Only documentation changed","steps":[]}"#,true,json!([]));
        assert_eq!(decision["state"],"unverified");
        assert_eq!(decision["verificationRequired"],false);
        let invalid = report(r#"{"verificationRequired":false,"state":"passed","steps":[]}"#,true,json!([]));
        assert_eq!(invalid["state"],"unverified");
        assert!(invalid["verificationRequired"].is_null());
    }

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
