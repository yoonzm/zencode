# ZenCode

Tauri 2 + Rust desktop application, retaining the React / TypeScript / Tailwind 4 interface from [yoonzm/zencode-ui](https://github.com/yoonzm/zencode-ui), baseline `33c33acb1e557d00d4016fcb9d677cd44ff0ed88`.

## Development

Install Node.js 24, stable Rust, Git, and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Install and log into the official Codex CLI separately (`codex login`). ZenCode uses the CLI's existing account and default model; the three model choices select low/medium/high reasoning effort.

```
npm ci
npm run typecheck
npm test
npm start
npm run package
```

`npm test` builds/tests the Rust core without native WebView dependencies. Full desktop builds require platform libraries. `npm run build` produces the original interface in `dist` with an external script for Tauri CSP.

## Runtime

- Rust performs HTTP requests, Git operations and the Codex app-server JSON-RPC protocol. There is no bundled Node/Electron server.
- Windows credentials use Credential Manager; macOS uses Keychain through keyring. Credentials are never saved in renderer localStorage. Linux credential persistence is explicitly unsupported in this release.
- Task state is saved in the OS application data directory, with a backup on replacement. A damaged state file is reported, not silently reset.
- ZenTao REST v1 (`/api.php/v1`) uses token or password authentication. Synchronization paginates products, bugs and stories and reads task details. Product mappings determine repository selection.
- Each task gets an isolated Git worktree and branch under application data. Existing user checkout changes are not discarded. Execution failures and app interruption retain the worktree and history.
- Codex uses `app-server --listen stdio://`, thread start/resume, turn start/steer/interrupt, message streaming and command/file approval responses. “Always” currently means the current Codex session. Pause interrupts the current turn; resume creates a new turn in the same thread, not an OS process freeze.
- Review shows a real Git diff, including new files. Clicking MR stages, commits and pushes that isolated branch, then creates/reuses the MR and writes its link to ZenTao. Git push uses the user's configured Git credential helper/SSH, independently of the API PAT. Origin is verified against the configured GitLab project before push.
- MR failure remains reviewable. If MR creation succeeds but ZenTao writeback fails, retry reuses the recorded MR. ZenTao status is not automatically transitioned because edition-specific workflow rules have not been validated.

## Installers and validation limits

The `Desktop installers` GitHub Actions workflow builds Windows x64 NSIS `.exe`, macOS Apple Silicon `.dmg`, and macOS Intel `.dmg`. Artifacts are private workflow downloads, not public releases. Signing/notarization credentials are not configured.

This is an implementation in validation, not a claim of complete production readiness. Live ZenTao/GitLab integration, native Windows/macOS smoke testing, and credential-vault roundtrips require those systems/accounts. The current API adapter does not yet download attachments or support legacy ZenTao APIs. Unsupported Codex interaction requests fail explicitly. No external test tenant is included, and no successful remote mutation is fabricated. See test output and workflow artifacts for verified results.
