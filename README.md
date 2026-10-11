# Codex Inventory v0.6

**Language: English | [日本語](README.ja.md)**

**A pixel-art, local-first desktop UI for Codex App Server.** Codex Inventory lets you browse your conversations, manage concurrent threads, monitor usage limits and reset tickets, run local tools, and explicitly review permission requests.

> **Independent and unofficial.** This is a community-developed application, not developed, sponsored, certified, endorsed or supported by OpenAI. It does not bundle Codex CLI, credentials, subscriptions or usage credits. You must have your own compatible Codex environment and account.

**License:** [MIT](LICENSE) © 2026 morio-23. See [Contributing](CONTRIBUTING.md) and [Security policy](SECURITY.md).

**Release status:** Windows v0.6 EXEs are still undergoing release acceptance. Once approved, Setup and Portable executables and their SHA-256 checksums will be distributed via [GitHub Releases](https://github.com/morio-23/codex-inventory/releases), **not committed to Git**. No approved binary release is implied by the presence of source code. See the [release checklist](RELEASE_ACCEPTANCE.md) or its [Japanese version](RELEASE_ACCEPTANCE.ja.md).

**Public source repository:** This is an MIT-licensed independent OSS project with a fresh Git history. GitHub Actions runs only when explicitly started; [run tests locally](PUBLICATION_CHECKLIST.md). **Windows EXE distribution has not been approved yet.**

## Interface language (English / 日本語)

The app detects the initial interface language from your browser/Windows locale and supports **English and Japanese**. Use **Language / 言語** in the upper-right corner to switch immediately. The selection is saved locally and persists after restart. Switching never translates, rewrites or resends your chat messages, user-authored templates, draft text, file contents, or workspace identifiers.

Built-in tool names, core UI, reset ticket confirmation and the 16 built-in prompt bodies have English text. Built-in prompt IDs and saved inventory/category keys stay stable. Some messages returned directly from older versions of Codex CLI and local scripts may remain in their original language.

**Verification:** New i18n tests and en-US Playwright flows cover auto-detection, persistence, ticket safety, explicit approvals and responsive layouts. Windows EXE and real-Codex E2E still need to pass the release gates in [Windows release checklist](RELEASE_ACCEPTANCE.md).

## Requirements and quick start (Windows 11)

To run from source: Windows 11, Node.js 20+ and a compatible, authenticated [Codex CLI](https://github.com/openai/codex).

~~~powershell
npm install -g @openai/codex
codex login
git clone https://github.com/morio-23/codex-inventory.git
cd codex-inventory
Set-ExecutionPolicy -Scope Process Bypass -Force
.\run.ps1
~~~

Open http://127.0.0.1:8765 if a browser window does not open automatically. Stop any older local server using that port first. Normal source startup does not need npm install in this repository; npm and Playwright are needed for development tests. PowerShell launch scripts use Windows PowerShell 5.1-compatible encoding.

To run entirely against mock data without touching your Codex account:

~~~powershell
.\run.ps1 -Demo
~~~

Demo numbers and conversations are fixtures, not actual usage or chat history. When there are no discovered projects, you can specify a temporary demo workspace using the -Workspace option.

## Model and reasoning-effort selection

The editor provides **Model** and **Reasoning effort** dropdowns. Available combinations come from the connected App Server's model/list response; the UI offers only effort levels reported by the selected model, in their supplied order (such as low, medium, high, xhigh, max and ultra when supported).

- **Inherit Codex configuration** is the default and does not intentionally override a thread's model or effort.
- Choosing a model and effort applies both values to the next turn/start request. Choosing only a model selects that model's advertised default effort to avoid inheriting an incompatible old setting. Choosing only an effort explicitly supplies the model catalogue's default model.
- Existing chats can be adjusted; a previous turn override may persist to later turns, so selecting “inherit” might not revert a prior explicit setting.
- Preferences are stored per workspace in the browser. The application does not rewrite config.toml or the global Codex Desktop configuration.
- Before sending, the backend rechecks the model/list catalogue and rejects unsupported pairs with HTTP 400. If the catalogue cannot be retrieved, the controls are disabled and Codex defaults apply.
- A selected effort is a **request**, not evidence of the compute effort ultimately used by the backend.

The mock App Server tests model/effort compatibility, persistence, new and existing threads, and invalid-choice rejection. Routine automated tests do not invoke real Codex inference.

## Integrated Windows verification (v0.6)

~~~powershell
.\verify-release.ps1
~~~

The release verifier installs the pinned Node dependencies, obtains Playwright Chromium, runs syntax/validation checks, Node tests and browser E2E, and builds both Windows EXEs. The unreleased release-readiness changes add isolated Portable EXE smoke checks; consult the current branch's [release acceptance checklist](RELEASE_ACCEPTANCE.md) for the actual gates.

Standard automated tests do **not** start authenticated, billable real-Codex turns or consume genuine reset tickets. Windows EXEs can launch without Node.js being installed on the receiving PC, although invoking a project's own npm test/lint scripts still requires Node/npm on that PC.

On first launch, register a project with the native **+ folder picker** if none is discovered. Registered folders are kept in the same Windows user's application settings.

## Local test/lint execution and explicit confirmation

The **Test** and **Lint** tools run the selected project's npm scripts without starting a Codex turn. However, npm scripts execute arbitrary project-defined code and can modify files, send network requests, or incur external costs.

- Preview shows the actual pretest/test/posttest or prelint/lint/postlint command text from package.json and the selected workspace. Cancelling the confirmation does not run them.
- A server-issued confirmation token expires after **60 seconds**, can be used only once, and is bound to the project, item and SHA-256 of package.json. Merely sending an “approved” boolean is not sufficient.
- The server rereads package.json immediately before execution, rejects changed hashes with HTTP 409, and never reuses a consumed token.
- Execution uses a fixed process invocation (shell:false), with a **60-second timeout** and a **1 MB output cap**. On cancellation or timeout it attempts to terminate the process tree (taskkill /T /F on Windows).
- **Limitations:** npm rereads the manifest independently and a tiny time-of-check/time-of-use race remains; detached processes may outlive their launcher. This is **not an execution sandbox**.
- The HTTP API is confined to 127.0.0.1 and has **no user authentication**. Single-use confirmation tokens protect against accidental clicks, replay and manifest changes, but do not defend against a malicious local process. Never expose it through Cloudflare Tunnel or any other proxy.

Local acceptance tests cover direct POST rejection, expired/replayed/mismatched tokens, manifest substitution, cancellation, lifecycle limits and regressions. Fixtures run in throwaway workspaces; no real project is modified.

## Genuine Codex reset tickets (v0.5.2)

If your connected Codex App Server reports saved rate-limit reset credits, Inventory displays them as a dedicated, **permanently visible reset-ticket item** with an owned-count badge; this is different from creating a new chat.

- account/rateLimits/read provides the availableCount and, if supported, ticket labels, expiration and status. Missing counts display **unknown**, not zero; an explicit zero displays zero.
- The usage panel shows owned tickets and the earliest known expiration. The compact pinned item is visible on every catalogue category/page; a ticket also appears in the hotbar when assigned. It is not duplicated among the nine catalogue slots.
- **Redemption requires explicit consent:** select a ticket → review details → tick the acknowledgement that one ticket will be consumed → confirm consumption. Cancellation is the default. Inspecting an item or opening the dialog does not redeem anything.
- Just before redemption, the server rechecks the account, count, ticket state and expiration. It uses a **one-shot, 60-second** confirmation token. Only the final confirmation sends account/rateLimitResetCredit/consume with an idempotencyKey and selected creditId.
- If individual ticket identifiers are unavailable, the UI explains when Codex will choose the next available ticket rather than inventing metadata.
- After redemption the app refreshes quota/counts and distinguishes reset, alreadyRedeemed, nothingToReset, noCredit and error outcomes. It does not automatically retry an uncertain failure, to avoid consuming twice.
- **Important:** these are finite, irreversible entitlements, separate from additional API charges. The CLI/backend may not support consumption for every account state. The app uses documented App Server APIs, not private ChatGPT HTTP endpoints or account credential files.

Automated reset-credit service/API and Playwright tests redeem **fictional mock credits only**; there is no automatic test that spends a real ticket.

## Windows desktop distribution (in preparation)

Two Windows 11 x64 Electron targets are built locally:

- **Setup:** CodexInventory-Setup-0.6.0-x64.exe
- **Portable:** CodexInventory-Portable-0.6.0-x64.exe
- **Checksums:** SHA256SUMS.txt

These names are build outputs, **not files available merely by cloning**. After acceptance they belong to GitHub Releases. The generated dist/ directory stays ignored by Git; do not commit EXEs or checksum manifests tied to stale builds.

### First-run flow

1. Install Setup, or launch Portable directly.
2. Inventory searches for a compatible Codex CLI/App Server binary from PATH, npm/Scoop/WinGet/standalone locations, Codex Desktop sidecars, and where available the Windows Store Codex App user's runtime cache.
3. A compatible binary is version-checked before an independent codex app-server process is launched. The app uses the current Windows user's Codex login and history without embedding or copying their credentials.
4. If no compatible CLI works, options include retry, manual executable selection, official installation instructions or exit. Inventory does not install the CLI or collect credentials on the user's behalf. Even a PC with Codex Desktop installed may need a separate CLI.
5. The newest available history workspace can be selected automatically. If nothing is detected, no project is chosen implicitly; use the native **+** folder picker.

The app does not attach to another running Desktop stdio process. It starts its **own App Server** using a compatible Codex CLI binary, which may have been unpacked by Codex Desktop. Access to protected WindowsApps installations is not assumed.

### Build locally (Windows)

~~~powershell
git switch main
git pull --ff-only
npm ci
npx playwright install chromium
.\build-windows.ps1
~~~

desktop/package-lock.json is tracked and should be used with npm ci for reproducible builds. For Portable only, use the -PortableOnly switch. -SkipTests avoids a redundant pass only after the same commit has already passed release acceptance. Before distributing, verify clean Windows installation/launch, fallback detection, log-out behavior, project isolation, Unicode paths, process shutdown, absence of private data, third-party license notices, Authenticode status and SHA-256.

**Unsigned EXEs may trigger Windows SmartScreen.** There is no automatic updater; installing a new version is manual. General-public distribution is held until the release acceptance gates pass.

## Workspace auto-discovery (no required -Workspace flag)

On Windows, .\run.ps1 starts a local App Server and inspects up to **3,000 history entries across 30 pages** from thread/list for the same OS user/CODEX_HOME. Existing cwd values are deduplicated to discover projects and the latest valid folder may be preselected.

- The project selector shows names and thread counts, with an option to refresh discoveries.
- Switching projects restores its chat selection, hotbar and templates; UI preferences are stored in the browser.
- Unicode, emoji, spaces and percent characters in paths are supported. The X-Codex-Workspace header is URI-encoded and checked after decoding against the currently selected server workspace.
- New chats, turns and local tools are always scoped to the chosen project; the server rejects cross-workspace actions, including stale requests from another browser tab.
- Projects without Codex history cannot be auto-discovered, but the Desktop edition's **+** picker can register them. Deleted directories are not selectable. Inventory never silently treats its own install directory as a project.
- Use the optional -Workspace parameter to pin a workspace; this disables project switching from the UI.

~~~powershell
.\run.ps1 -Workspace 'C:\dev\sample-project'
~~~

No full-drive crawl is performed. Workspaces absent from the first 3,000 history entries may not appear. Demo mode can also use -Workspace.

## Local tools, catalogue and prompt templates (v0.5)

Inventory provides **16 local tools** and **16 standard prompt templates**. Selecting a template does not send a request to Codex.

- Local tools cover Git status/diff/history/branches/untracked/conflicts/staged/tracked files, code search, TODO search, directory trees, README/manifest summaries, dependency summaries, diagnostics, test and lint.
- Fixed read-only Git and ripgrep commands use execFile with shell:false. An internal bounded search is used when rg is not available. Sensitive-looking files, symlinks and paths outside the current workspace are excluded; runtime, file count, size and output are limited.
- Test/lint scripts are exceptions: they execute only after the explicit npm-script confirmation flow above.
- Results appear in a dedicated panel, not as fake Codex chat history. **No Codex usage** means no Codex turn starts; local CPU usage or external project-script costs may still occur.
- Inventory has a pinned reset-ticket item, a nine-slot catalogue and a configurable nine-slot quick bar. Templates can be customized/imported/exported per workspace.
- Local results can be selected for attachment to a **future** Codex prompt. Nothing is sent until you explicitly start the turn; the UI shows selected result counts and a preview.
- Local endpoints include GET /api/items, POST /api/local-tools/:id and GET /api/templates. The browser cannot supply an arbitrary command or cwd.

## Workbench UI

The 16 local tools and template editor are collapsed initially so that chats, inventory and quota remain prominent. The bottom **Toolbox** and **Prompt Library** buttons open full-width workbench panels, one at a time.

Tabs support keyboard arrows and Home/End. Escape or Close hides a panel without immediately discarding unsaved form text. Running a local item opens its results; selecting a template opens its editor. Toggling panels never starts Codex. Playwright covers reopen/persistence, keyboard interactions and small/large viewport overflow.

## Three core chat and quota features

### 1. Cross-referencing Codex Desktop conversations

Inventory reads thread/list and thread/read from the same OS user's Codex App Server/CODEX_HOME. It uses the **real thread IDs**, not invented identifiers, and continues existing threads through thread/resume and turn/start.

On 2026-10-09, authenticated Codex CLI 0.144.6 on Windows was checked for Desktop → Inventory and Inventory → Desktop history visibility and continuation. This is not a guarantee across all Desktop versions or sourceKind/index states. The same Desktop conversation should not be edited concurrently from two processes.

### 2. Multiple concurrent chats and notifications

- List current-workspace threads, optionally browse other projects' history in read-only mode; create, read, resume, switch, concurrently run and interrupt turns.
- Receive events via SSE and refresh lists periodically (about 15 seconds).
- On turn/completed, show completed, failed or interrupted indicators in the UI; the Electron edition can send fixed-text native Windows notifications (subject to Windows permissions). Clicking brings Inventory to the front. Prompts, command contents and private paths do **not** appear in native notifications. Completion notification preference is saved locally.
- Notifications describe outcomes received **while Inventory is running**, not turns that finish after it has closed or unrelated Codex processes.
- Command output rows are initially collapsed, can be expanded or copied, and long commands scroll inside the output.
- App Server history is restored through thread/read on reload; duplicate simultaneous turns on one thread are rejected.
- On command execution, file change or additional file/network permission requests, an explicit approval panel shows available details and offers **Allow once**, **Allow for session**, or **Decline**.
- Approvals are bound to a running turn and workspace, **expire after 120 seconds**, and are rejected on timeout, interruption, disconnect or completion. Duplicate responses are blocked and pending approvals can be restored on SSE reconnect. Unsupported requests fail closed; no automatic approval.

### 3. Actual usage and quotas

- Read primary/secondary quota information from account/rateLimits/read, showing **5-hour** for 300-minute windows and **weekly** for 10,080-minute windows, otherwise preserving the actual duration returned by the API.
- Derive remaining percentages from usedPercent, and show resetsAt when available.
- Show active-thread token usage from thread/tokenUsage/updated. When unavailable or unsupported, display **unavailable**, not made-up numbers.
- Historical token usage from before an Inventory restart may be unknown.

## Workspace isolation and security

Browsing **all projects** is for history inspection; turns can be started only in the currently selected project. Both UI and API check the selected cwd to prevent accidental cross-project execution.

The HTTP server listens on **127.0.0.1**, checks Host/Origin, and uses a safe DOM Markdown renderer. Read-only is the default, and edits require explicit permission. **Do not expose the service** through Cloudflare Tunnel, LAN forwarding, or a public server. See [SECURITY.md](SECURITY.md) for limitations of unauthenticated local HTTP.

## Optional real Codex editing E2E

Authenticated real-Codex tests are **not** part of default CI. The opt-in editing test creates a **temporary Git workspace**, asks Codex to create one proof file and inspects it. It does not modify existing user projects.

~~~powershell
$env:CODEX_E2E_REAL='1'
$env:CODEX_E2E_WRITE='1'
npm run test:e2e:real
Remove-Item Env:CODEX_E2E_WRITE
Remove-Item Env:CODEX_E2E_REAL
~~~

This uses real model quota and is sensitive to CLI version and Windows sandbox settings. Further isolated approval tests are prepared in the [Windows release checklist](RELEASE_ACCEPTANCE.md).

## Source layout and tests

- server.mjs — local HTTP, REST endpoints and SSE
- app-server-client.mjs — stdio JSON-RPC transport to codex app-server
- codex-service.mjs — thread/read/list/resume, turn/start/interrupt, quotas
- public/ — pixel-art UI, inventory, quota and history views
- tests/fixtures/mock-app-server.mjs — deterministic demo/integration backend

~~~powershell
npm ci
npx playwright install chromium
npm run check
npm test
npm run test:e2e
~~~

The browser suite tests mock chat concurrency, resume, interruptions, connection/timeouts, local tools, templates, approval UI and quota fallbacks. The existing opt-in real CLI scenarios can be run with CODEX_E2E_REAL=1; a Desktop-owned test thread can be specified via CODEX_DESKTOP_THREAD_ID and CODEX_DESKTOP_EXPECT_TEXT. They consume real quota and should use **test-owned conversations only**.

## Community

Bug reports and focused pull requests are welcome. Use [Issues](https://github.com/morio-23/codex-inventory/issues) and [CONTRIBUTING.md](CONTRIBUTING.md). Please report vulnerabilities privately following [SECURITY.md](SECURITY.md). License: [MIT](LICENSE).
