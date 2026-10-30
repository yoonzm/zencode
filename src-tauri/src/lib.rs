mod feishu;
mod manual;
pub mod codex;
mod cleanup;
mod matching;
mod matching_evidence;
mod matching_scope;
pub mod runtime;
pub mod services;
pub mod storage;
mod verification;
mod verification_shots;
mod verification_tools;
pub mod update_feed;
pub type Result<T> = std::result::Result<T, String>;
pub fn text<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
