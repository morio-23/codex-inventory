# Codex Inventory v0.6 — Windows Release Acceptance

**Language: English | [日本語](RELEASE_ACCEPTANCE.ja.md)**

This checklist applies **after all release source changes are merged into main**. It can be executed locally on Windows without paying for GitHub Actions. Passing the mock suite and compiling an EXE are not proof that the application works on another user's PC.

## Integrated local verification

~~~powershell
git switch main
git pull --ff-only
Set-ExecutionPolicy -Scope Process Bypass -Force
.\verify-release.ps1
~~~

Run this on the current public main commit. It runs npm ci, Playwright Chromium installation, npm run check, npm test, npm run test:e2e, the Windows Setup/Portable EXE build, and an isolated mock Portable EXE smoke test. The smoke uses a temporary Electron userData profile and mock CLI, then compares the existing settings.json presence, size, modification time and SHA-256 before and after. Files are written to dist/. **Standard tests do not invoke real authenticated Codex turns or consume genuine reset tickets.**

If you only need to run automated tests:

~~~powershell
.\verify-release.ps1 -SkipExe
~~~

desktop/package-lock.json is tracked. Use the pinned lockfile with npm ci and review dependencies and third-party licenses before distribution.

`-SkipPortableSmoke` is diagnostic only and leaves the Portable smoke gate as SKIP. `-RequireSigned` rejects unsigned EXEs. Every build records Authenticode status and generates `dist/THIRD_PARTY_REVIEW.json`; this is a lockfile declaration inventory, not the actual license texts or legal clearance. Run `npm audit` and `npm audit --omit=dev`, inspect the packaged license notices and content, and confirm the generated hashes against the two EXEs. No EXE or test profile belongs in Git.

## Opt-in checks in disposable Windows environments

Use a disposable Windows user account or VM with a compatible, authenticated Codex CLI. Real permission checks invoke a model and use only temporary files; a missing permission request is a failure, not proof of approval behavior. Never redeem a real reset ticket.

~~~powershell
$env:CODEX_E2E_REAL='1'
$env:CODEX_E2E_APPROVAL='1'
npx playwright test tests/e2e/inventory.spec.mjs --grep '@real @approval' --workers=1
Remove-Item Env:CODEX_E2E_APPROVAL
Remove-Item Env:CODEX_E2E_REAL
~~~

Confirm the denial leaves the temporary proof file absent and one-time approval creates exactly the expected file. If Codex avoids the tool call, or the test account cannot be used, record SKIP or FAIL with the reason. Save sanitized evidence outside Git.

Run Setup only inside a disposable Windows Sandbox/VM. Installation can change per-user registry entries even with a temporary install directory:

~~~powershell
$env:CODEX_INVENTORY_DISPOSABLE_VM='YES'
.\verify-setup-disposable-vm.ps1 -SetupExe .\dist\CodexInventory-Setup-0.6.0-x64.exe -DisposableVmConfirmed
Remove-Item Env:CODEX_INVENTORY_DISPOSABLE_VM
~~~

In that VM, launch the installed app and inspect uninstall registration and leftover files. Repeat first-run with Codex CLI absent: check Retry, Select CLI, Installation help and Exit. Observe a completion and approval notification in Windows Notification Center, then click and confirm that Inventory is focused, including while minimized. Test notification opt-out. API `shown:true` alone does not pass this gate.

Further isolation, signing and disposable-machine installer checks are not yet confirmed in the public source. They require separate Windows verification; do not mark these gates as passed based on mock tests.

## Manual Windows acceptance (including another PC/account)

- [ ] Install, launch and uninstall dist/CodexInventory-Setup-0.6.0-x64.exe.
- [ ] Launch dist/CodexInventory-Portable-0.6.0-x64.exe without installation.
- [ ] GUI launches on a PC without Node.js. Explain that Node/npm is still needed to run project-defined npm test/lint scripts.
- [ ] When Codex CLI is absent, Retry, Select CLI, Installation instructions and Exit work.
- [ ] A compatible user-cache binary is found when the Codex App is installed but a standalone CLI is absent, if the cache exists.
- [ ] Multiple candidates fall back correctly when the first detected binary is incompatible.
- [ ] Logged-in and logged-out states are distinguished, and no authentication data is embedded in either EXE.
- [ ] With no chat history, use the native + folder picker to register a new project and create a chat.
- [ ] Project registration survives an EXE restart; switching projects never sends a turn to the wrong cwd.
- [ ] Quick bar, templates, drafts and chat selection survive a restart.
- [ ] Existing Codex Desktop conversation history can be viewed; foreign-workspace threads run only after selecting their owning workspace.
- [ ] Local code search, Git diffs and test/lint use the selected cwd; npm scripts cannot run without explicit confirmation.
- [ ] **Mock** reset credits: select, inspect, confirm and consume exactly once; cancellation and replay must consume none.
- [ ] Validate Unicode, whitespace and long paths; another Windows user profile; port collisions; double launch; and no App Server child process left behind on exit.
- [ ] Release artifacts contain **no personal credentials, local history, private development projects or test profiles**.
- [ ] Checksums in dist/SHA256SUMS.txt match the actual EXE files.
- [ ] Check third-party license notices, Authenticode signature/unsigned SmartScreen warnings, and how users install a new version.
- [ ] On a disposable Windows VM/user, test actual App Server command/file/network **approval and decline** rather than treating mock results as real integration.
- [ ] Observe Windows notifications in Notification Center; a successful API return is not sufficient.

## Known limitations

- Inventory does not attach to a Codex Desktop stdio server already running in another process. It starts its own App Server using a compatible codex.exe when available.
- Some systems need an independently installed official Codex CLI even when the Codex Desktop app is installed.
- Electron launches without Node/npm on the target PC, but a project's npm test/lint operation requires Node/npm.
- npm scripts can modify files or incur external charges. The confirmation and hash check do **not** make scripts a sandbox.
- Real authenticated Codex editing E2E is an **explicit opt-in** and uses temporary folders only.
- Genuine reset-credit usage is irreversible. **Never consume real credits from automated E2E.**
- Unsigned executables may trigger SmartScreen. Release signing requires a publisher-owned certificate and a deliberate policy.
- There is **no automatic updater**; Setup and Portable builds are distributed and installed manually.

## Where to distribute binaries

Generate executable files in dist/, which is excluded by .gitignore. **Do not commit EXEs to Git history or Git LFS.** Once acceptance is passed, attach the Windows Setup and Portable EXEs, SHA256SUMS.txt, any required third-party notices, and matching English/Japanese release notes to [GitHub Releases](https://github.com/morio-23/codex-inventory/releases).

Recheck downloaded asset hashes, disclose unsigned status and known limitations, and do not upload stale artifacts. GitHub Releases provides versioned downloads without inflating normal Git clones.

This public repository uses a new Git history. Always review future screenshots, changed files and third-party dependencies before publishing. Public source and public EXE distribution are separate.
