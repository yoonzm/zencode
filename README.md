# ZenCode

Tauri 2 + Rust desktop application, retaining the React / TypeScript / Tailwind 4 interface from [yoonzm/zencode-ui](https://github.com/yoonzm/zencode-ui), initial baseline `33c33acb1e557d00d4016fcb9d677cd44ff0ed88`, with shell/settings and per-connection TLS controls selectively synchronized through `7c9b4eb`. Desktop service wiring and fixes are retained; prototype simulation controls are excluded.

## Development

The macOS build requires macOS 13.3+ to match the existing UI’s Safari 16.4 CSS target.

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

- Native OS window decorations provide the window controls. Platform appearance and shortcut labels follow the actual runtime platform; prototype platform overrides are no longer restored.
- ZenTao and GitLab each offer an opt-in **Advanced > Skip certificate verification** setting (off by default). It applies only to that service's API client, including authentication, synchronization, attachments and MR API/writeback requests. Certificate failures reveal the setting; successful tests identify when verification was skipped. Git push retains the local Git TLS configuration. No global TLS or Git settings are changed.
- Rust performs HTTP requests, Git operations and the Codex app-server JSON-RPC protocol. There is no bundled Node/Electron server.
- Windows credentials use Credential Manager; macOS uses Keychain through keyring. Credentials are never saved in renderer localStorage. Linux credential persistence is explicitly unsupported in this release.
- Task state is saved in the OS application data directory, with a backup on replacement. A damaged state file is reported, not silently reset.
- ZenTao REST v1 (`/api.php/v1`) uses token or password authentication. Synchronization only reads bugs, stories and task details for products with a configured repository mapping. Within those products, the synchronization scope selects either tasks assigned to the configured account or all assignees. The full product catalog remains available for configuring mappings.
- Each task gets an isolated Git worktree and branch under application data. Existing user checkout changes are not discarded. Execution failures and app interruption retain the worktree and history.
- Codex uses `app-server --listen stdio://`, thread start/resume, turn start/steer/interrupt, message streaming and command/file approval responses. “Always” currently means the current Codex session. Pause interrupts the current turn; resume creates a new turn in the same thread, not an OS process freeze.
- Review shows a real Git diff, including new files. Clicking MR stages, commits and pushes that isolated branch, then creates/reuses the MR and writes its link to ZenTao. Git push uses the user's configured Git credential helper/SSH, independently of the API PAT. Origin is verified against the configured GitLab project before push.
- Before MR submission, all effective `origin` push URLs are checked against the project's GitLab-provided SSH or HTTP clone URL. SSH and HTTP API ports are independent; a separate or additional `pushurl` must still match the project.
- MR failure remains reviewable. If MR creation succeeds but ZenTao writeback fails, the review view keeps the MR open/copy actions and offers a writeback retry instead of another create action. Empty or invalid JSON responses identify the failing endpoint without exposing response bodies. A history readback is attempted even when the comment response fails; only a verified link completes the task. Manual insertion of the MR link in ZenTao followed by retry is also verified without posting another comment. ZenTao status and fix version are preserved; only the MR link is added.

## Installers and validation limits

The `Desktop installers` GitHub Actions workflow builds Windows x64 NSIS `.exe`, macOS Apple Silicon `.dmg`, and macOS Intel `.dmg`. Artifacts are private workflow downloads, not public releases. Signing/notarization credentials are not configured.

This is an implementation in validation, not a claim of complete production readiness. Live ZenTao/GitLab integration, interactive Windows/macOS flows, and credential-vault roundtrips still require those systems/accounts. Attachment downloads require a binary REST v1 file response (up to 50 MB); incompatible preview/JSON responses report an error. Legacy ZenTao APIs are not supported. MR writeback only adds a link and never changes task status or fix version. It uses the v2 action comment endpoint, with a v1 comments fallback only on HTTP 404/405, followed by a readback check; servers without a working comments endpoint keep the task in review with its MR link. Unsupported Codex interaction requests fail explicitly. No external test tenant is included, and no successful remote mutation is fabricated. See test output and workflow artifacts for verified results.

## Verified locally

- TypeScript typecheck and production UI build pass.
- Ten Rust tests pass: URL validation, task identity normalization, GitLab remote validation, state persistence, HTTP pagination/authentication, task synchronization/attachments, crash recovery, a Git-backed app-server fixture covering approval/pause/resume/diff, MR writeback retry without duplicate MR creation, and link-only modern ZenTao comments.
- `cargo run --no-default-features --example check_codex` is a read-only protocol/account smoke check. In the selected cloud environment the installed CLI exits before initialization because `/home/agent/.codex` is read-only; no real model execution has been asserted. A second check using an empty, isolated writable CLI configuration succeeded in initializing the actual app-server and correctly reported no configured account.
- All original `src/styles` files remain byte-for-byte unchanged. Visual pixel parity remains unverified: both baseline and current pages were blocked by the environment browser policy. Windows installer launch smoke testing passes in CI; macOS disk images are mounted and verified, but interactive native flows still require a real desktop.

A frontend persistence regression test also verifies that vault failures do not create a toast/save retry loop, explicit retries work, and obsolete prototype platform/window-control preferences are ignored.

## Versioned releases

Ordinary branch pushes build private CI artifacts only. After updating package/Tauri versions consistently, push a `vX.Y.Z` tag to build all three installers and publish a Release only after their tests and platform checks succeed. Only the release job requests contents write permission; repository access settings remain unchanged.

To publish an already verified build, manually run **Publish verified installers** with its successful Desktop installers run ID, exact 40-character commit SHA and matching version tag. This reuses the original artifacts. Conflicting tags or existing releases are rejected; assets are never overwritten. Upload failures leave a draft for inspection. Installer checksums are included in SHA256SUMS.txt. Keep validation limitations in the release notes current before future versions.

Tag pushes now run a lightweight build-decision check before allocating the Windows/macOS matrix. A tag with an existing same-SHA release (including an upload-complete draft during publication) skips the matrix and automatic release job only when its recorded Desktop installers run succeeded, all three platform jobs passed, all three source artifacts remain available, and the three versioned installers plus checksum manifest are uploaded and hashed. A mismatched SHA or incomplete/expired/unverified artifact set fails the check for inspection instead of silently reusing or overwriting it. New tags without a release, branch pushes and manual builds still build normally. This avoids re-packaging after publishing existing installers; the small decision job may still consume a runner minute. Test locally with `python3 -m unittest discover -s test -p '*_test.py'`.
