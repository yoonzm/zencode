pub mod services;
pub mod storage;
pub mod codex;
pub mod runtime;
pub type Result<T> = std::result::Result<T, String>;
pub fn text<'a>(v: &'a serde_json::Value, key: &str) -> &'a str { v.get(key).and_then(|x| x.as_str()).unwrap_or("") }
pub fn now() -> i64 { chrono::Utc::now().timestamp_millis() }
