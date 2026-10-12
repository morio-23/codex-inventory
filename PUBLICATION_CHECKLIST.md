# Source publication and Windows release policy

**Language: English | [日本語](PUBLICATION_CHECKLIST.ja.md)**

Codex Inventory is an independent MIT-licensed open-source project. This public repository was initialized with a **new Git history**, without the previous private development repository's commits, Issue/PR history, personal screenshots, executable builds or local application settings.

## No paid GitHub Actions

The only workflow trigger is `workflow_dispatch`; **push and pull request events do not start hosted jobs**. Please do not click "Run workflow" unless the runner budget is approved. Contributors run the existing tests locally:

~~~powershell
npm ci
npx playwright install chromium
npm run check
npm test
npm run test:e2e
~~~

Record OS, Node version, commit SHA and test PASS/FAIL/SKIP counts in your PR. The normal suite uses mock App Server data and does not redeem real reset tickets. Opt-in real Codex tests consume the tester's own model quota. Local success is **not** a GitHub Actions PASS.

## Source privacy

Do not commit private projects, personal conversations, access tokens, developer paths, user-profile configuration, or raw screenshots of private content. The repository contains a local check at `scripts/audit-public-source.ps1` and ignores release evidence, credential files and compiled binaries. This check is heuristic; manually inspect changes and screenshots before every public commit.

## Windows binaries are not released yet

Source availability is separate from EXE distribution. **No official Windows binary is available in GitHub Releases yet.** The Windows release needs isolated profile testing, real permission approval/decline checks, Setup installation/uninstallation, notification-center inspection, signing status, third-party license notices and checksum verification. See [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) ([日本語](RELEASE_ACCEPTANCE.ja.md)). Never publish an earlier test EXE merely to supply a downloadable asset.

## Independent project

Codex Inventory is not made, endorsed, sponsored, certified or supported by OpenAI. The MIT license covers project-owned source; third-party dependencies retain their own license terms.


## v0.7 concurrency and publication gate
- [ ] Run `npm run check`, `npm test`, and `npm run test:e2e` **locally against mocks**. Report aggregate results only.
- [ ] Run `node scripts/audit-v07-diff.mjs main` and `powershell -ExecutionPolicy Bypass -File scripts/audit-public-source.ps1`. Manually inspect diff, Git history, images, attachments and release files regardless of pass status.
- [ ] Verify activity feed, native notifications, screenshots and test artifacts never expose real prompts, command output, personal paths, session IDs or credentials.
- [ ] Exercise two simultaneous chats in distinct workspaces, approvals, interrupts and reconnect recovery using synthetic fixtures.
- [ ] Ensure cross-workspace writes and cross-thread approval spoofing are rejected.
- [ ] Do not run billable real-Codex E2E, paid GitHub Actions, merge to main, or publish an EXE without separate explicit approval.
