# ZenCode

Tauri 2 + Rust desktop application, retaining the React / TypeScript / Tailwind 4 interface from [yoonzm/zencode-ui](https://github.com/yoonzm/zencode-ui), initial baseline `33c33acb1e557d00d4016fcb9d677cd44ff0ed88`, with UI components synchronized through `51cf32b`. Desktop service wiring and fixes are retained; prototype simulation controls are excluded.

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

`npm test` builds/tests the Rust core without native WebView dependencies. Full desktop builds require platform libraries. `npm run build` uses Vite and Tailwind CSS to produce `dist` with external scripts and styles for Tauri CSP. UI primitives use Radix/shadcn, HeroUI, Magic UI, Motion, lucide-react, Zustand and cmdk. `npm run dev` starts the browser preview; desktop service calls require Tauri.

## Runtime

- Native OS window decorations provide the window controls. Platform appearance and shortcut labels follow the actual runtime platform; prototype platform overrides are no longer restored.
- ZenTao and GitLab each offer an opt-in **Advanced > Skip certificate verification** setting (off by default). It applies only to that service's API client, including authentication, synchronization, attachments and MR API requests. Certificate failures reveal the setting; successful tests identify when verification was skipped. Git push retains the local Git TLS configuration. No global TLS or Git settings are changed.
- Rust performs HTTP requests, Git operations and the Codex app-server JSON-RPC protocol. There is no bundled Node/Electron server.
- Windows credentials use Credential Manager; macOS uses Keychain through keyring. Credentials are never saved in renderer localStorage. Linux credential persistence is explicitly unsupported in this release.
- Task state is saved in the OS application data directory, with a backup on replacement. A damaged state file is reported, not silently reset.
- ZenTao REST v1 (`/api.php/v1`) uses token or password authentication. Synchronization only reads bugs, stories and task details for products with a configured repository mapping. Within those products, the synchronization scope selects either tasks assigned to the configured account or all assignees. The full product catalog remains available for configuring mappings.
- Automatic ZenTao synchronization defaults to every 5 minutes, including older saved configurations without this field. Settings allow disabling it or choosing 1?1440 minutes. It continues while the window is in the background, skips setup, avoids overlapping requests and keeps the current list on background failures. Failed attempts wait for the next configured interval.
- Automatic execution after synchronization defaults to enabled, including older configurations. Only newly imported tasks with repository mappings enter the existing concurrency queue; existing tasks are not restarted. Disable it in ZenTao settings to leave new tasks idle. Manual and scheduled sync follow the same rule, including locally deleted tasks imported again. Execution still requires human review before MR submission.
- Deleting a task removes its local record after stopping any active or queued execution; it does not modify ZenTao. The next synchronization imports it with a fresh run. Existing worktrees and Git branches remain on disk for recovery but are not reused by the imported task.
- Repository mappings select GitLab projects and target branches from the API, with pagination and refresh/error feedback. Local checkout paths are no longer required. Each new task execution clones the selected target branch into an isolated directory under application data and creates its own branch. Pause/resume retains the existing checkout and history. Clone and push use the local Git SSH/credential configuration; the API token is not written into clone URLs.
- Product, repository and branch selectors support search and a shared refresh action. A product can map to several repositories with individual branches, role labels and test commands. Synchronization creates a separate local task/run per repository, each with its own review and MR. Existing single-repository settings migrate on load; existing runs and task links are retained when the repository is unchanged. Reordering mappings does not restart runs.
- AI matching uses the configured Codex CLI to compare actual ZenTao BUGs/stories with GitLab commits, MRs and project events. Candidate products are deduplicated from all pages of the current authenticated ZenTao user's assigned BUGs/stories via `/user?fields=bug|story&type=assignedTo`; assignment age is not restricted. The token identity must match the configured account when supplied. Only those product details are fetched; unsupported workbench responses fail explicitly without falling back to the full catalog. Candidate repositories come from the GitLab token user's past-90-day events and authored/assigned/reviewed MRs, with pagination and no global repository scan. Subsequent evidence enrichment is scoped to these candidates and can include other contributors. It reads up to 100 BUGs and 100 stories per product (descending ID, with detail enrichment for the ten newest of each), and up to 100 entries per repository/source from the past 90 days, including commits across branches. Number references, business content, participants, branch names and dates inform suggestions; bare numeric IDs or activity alone are insufficient. Every accepted suggestion must cite real task and repository records belonging to that pair, and the dialog displays their actual excerpts. Confidence is a model estimate, not a verified probability. Sampling limits and partial API failures appear in the dialog. Matching has no product/repository count cutoff or local prompt-size cutoff. Collection uses per-request timeouts instead of a fixed total deadline; large catalogs can take longer and remain subject to the model context capacity. Per-source history sampling still applies. Credentials are excluded from the prompt. Applying suggestions edits only the draft mapping, with GitLab's actual default branch. Live model matching and native dropdown interactions still require desktop validation.
- Codex uses `app-server --listen stdio://`, thread start/resume, turn start/steer/interrupt, message streaming and command/file approval responses. “Always” currently means the current Codex session. Pause interrupts the current turn; resume creates a new turn in the same thread, not an OS process freeze.
- Review shows a real Git diff, including new files. Clicking MR stages, commits and pushes that isolated branch, then creates/reuses the MR and marks the local run complete. Git push uses the user's configured Git credential helper/SSH, independently of the API PAT. Origin is verified against the configured GitLab project before push.
- Before MR submission, all effective `origin` push URLs are checked against the project's GitLab-provided SSH or HTTP clone URL. SSH and HTTP API ports are independent; a separate or additional `pushurl` must still match the project.
- MR failure remains reviewable. Successful MR submission completes the local run without writing comments, links, status or fix versions to ZenTao. ZenTao status remains read-only and comes from synchronization. Legacy pending runs retain their MR open/copy actions and can finish submission without creating another MR.

## Installers and validation limits

The `Desktop installers` GitHub Actions workflow builds Windows x64 NSIS `.exe`, macOS Apple Silicon `.dmg`, and macOS Intel `.dmg`. Artifacts are private workflow downloads, not public releases. Signing/notarization credentials are not configured.

This is an implementation in validation, not a claim of complete production readiness. Live ZenTao/GitLab integration, interactive Windows/macOS flows, and credential-vault roundtrips still require those systems/accounts. Attachment downloads require a binary REST v1 file response (up to 50 MB); incompatible preview/JSON responses report an error. Legacy ZenTao APIs are not supported. MR submission does not write to ZenTao. Unsupported Codex interaction requests fail explicitly. No external test tenant is included, and no successful remote mutation is fabricated. See test output and workflow artifacts for verified results.

## Verified locally

- TypeScript typecheck and production UI build pass.
- Rust regression coverage includes: URL validation, task identity normalization, GitLab remote validation, state persistence, HTTP pagination/authentication, task synchronization/attachments, crash recovery, a Git-backed app-server fixture covering approval/pause/resume/diff, MR completion without ZenTao writes or duplicate MR creation, and link-only modern ZenTao comments.
- `cargo run --no-default-features --example check_codex` is a read-only protocol/account smoke check. In the selected cloud environment the installed CLI exits before initialization because `/home/agent/.codex` is read-only; no real model execution has been asserted. A second check using an empty, isolated writable CLI configuration succeeded in initializing the actual app-server and correctly reported no configured account.
- Styles and components are synchronized with the upstream UI stack. Interactive native Windows/macOS visual flows still require desktop validation.

A frontend persistence regression test also verifies that vault failures do not create a toast/save retry loop, explicit retries work, and obsolete prototype platform/window-control preferences are ignored.

## Versioned releases

Ordinary branch pushes build private CI artifacts only. After updating package/Tauri versions consistently, push a `vX.Y.Z` tag to build all three installers and publish a Release only after their tests and platform checks succeed. Only the release job requests contents write permission; repository access settings remain unchanged.

To publish an already verified build, manually run **Publish verified installers** with its successful Desktop installers run ID, exact 40-character commit SHA and matching version tag. This reuses the original artifacts. Conflicting tags or existing releases are rejected; assets are never overwritten. Upload failures leave a draft for inspection. Installer checksums are included in SHA256SUMS.txt. Keep validation limitations in the release notes current before future versions.

Tag pushes now run a lightweight build-decision check before allocating the Windows/macOS matrix. A tag with an existing same-SHA release (including an upload-complete draft during publication) skips the matrix and automatic release job only when its recorded Desktop installers run succeeded, all three platform jobs passed, all three source artifacts remain available, and the three versioned installers plus checksum manifest are uploaded and hashed. A mismatched SHA or incomplete/expired/unverified artifact set fails the check for inspection instead of silently reusing or overwriting it. New tags without a release, branch pushes and manual builds still build normally. This avoids re-packaging after publishing existing installers; the small decision job may still consume a runner minute. Test locally with `python3 -m unittest discover -s test -p '*_test.py'`.
