use zencode_core::codex::Session;
#[tokio::main]
async fn main() -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let (session, _) = Session::spawn("codex", &cwd).await?;
    let result = async {
        session.initialize().await?;
        session
            .request("account/read", serde_json::json!({"refreshToken":false}))
            .await
    }
    .await;
    session.close().await;
    let account = result?;
    println!(
        "Codex app-server handshake: OK; account configured: {}",
        !account["account"].is_null()
    );
    Ok(())
}
