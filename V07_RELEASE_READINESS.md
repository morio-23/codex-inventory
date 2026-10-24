# Codex Inventory v0.7.0-beta.1 — Release readiness (working draft)

> **Draft, not approval to ship.** Snapshot 2026-10-23 JST. This is a plan, not a test log. No GitHub Actions, merges to main, or binary distribution are authorized. [日本語](V07_RELEASE_READINESS.ja.md).

## Verified repository state

- Public `main` was `13ad1fbcb2092934423091ec7647ced790a23259` when reviewed.
- The [v0.6.0-beta.1 GitHub Release](https://github.com/morio-23/codex-inventory/releases/tag/v0.6.0-beta.1) already contains Setup, Portable and SHA256SUMS.txt, published October 11, 2026. Its GitHub `prerelease` flag is `false`. Existing downloads are **not** evidence that all acceptance gates passed.
- v0.7 currently sits on [Draft PR #16](https://github.com/morio-23/codex-inventory/pull/16), head `ef96d6cecaa1c8714f6c0bc8b66144f930f7af30`; at inspection: 43 commits ahead of main, 0 behind. No v0.7 EXEs have been released.
- Latest reported checks: PR #16 syntax checks pass, 162 Node tests passed, 1 skipped (Windows symlink privilege). PR #15 reported 54 mock E2E passing and 4 real-Codex skips. These are **historical results from different commits**, not fresh checks for this PR.
- **Hard blocker:** the October 14 read-only real App Server smoke stopped on `CONFIG_WARNING`. Its cause is unknown; an empty `thread/list`, non-access to authentication state, actual turns, approvals and reconnect have **not** been validated. Do not treat the warning as harmless or suppress it.

## Dependency and merge discipline

Individual feature PRs #7 (activity), #8 (workspace scoping), #9 (split pane) were superseded by the integration line. Do **not** merge each separately into main.

```text
main → #10 integration → #11 integration review → #12 backend
     → #13 frontend → #14 final validation → #15 protocol
     → #16 isolated smoke → release-readiness draft (this branch)
```

Review the cumulative single diff against the **current** main head before any eventual merge. Preserve the Draft state until approval.

## Release work breakdown

| ID | Task | Remote-only? | Acceptance |
|---|---|---|---|
| CI-01 | Identify exact cumulative branch/PR graph | Yes | No overlapping merges or undocumented changes |
| CI-02 | Identify root cause of `CONFIG_WARNING` | Partially | Isolated reproduced explanation/fix; warning not silently ignored |
| CI-03 | Prepare release branch, docs and gate tracking | Yes | Draft-only changes; main untouched |
| CI-04 | Run syntax and Node unit tests | No | Latest pinned SHA, 0 failures; skips documented |
| CI-05 | Run deterministic mock E2E | No | 3 threads / 2 workspaces, permissions, stop, SSE, split, locale and responsive |
| CI-06 | Safe real App Server read-only smoke | No | Isolated VM; handshake and empty history pass |
| CI-07 | Approved real turn and permission tests | No | Correct thread, turn, workspace and restore boundaries |
| CI-08 | Privacy, Git history, artifacts, dependencies and licenses | Partially | Manual review + tool output; zero private-data leaks |
| CI-09 | Build fresh Setup and Portable | No | Versioned binaries, proper SHA-256 and signature state |
| CI-10 | VM install/uninstall and native notifications | No | Actual Windows acceptance, not API-only proxies |
| CI-11 | Prepare truthful Japanese and English release notes | Yes | Historical results clearly distinguished from current tests |
| CI-12 | Approve merge, tag, Release assets | After gates | Downloaded assets match checksum, Pre-release enabled |

Local commands once Windows is available: `npm ci`, `npx playwright install chromium`, `npm run check`, `npm test`, `npm run test:e2e`, `git diff --check`, `node scripts/audit-v07-diff.mjs main`, `powershell -ExecutionPolicy Bypass -File scripts/audit-public-source.ps1`, and the Windows release verifier. Use [the disposable isolation procedure](V07_SMOKE_ISOLATION.ja.md) for real Codex tests; opt-in real inference and each permission-sensitive step require explicit approval. Do not copy real credentials, logs, local paths or chat content into a PR.

**Unpublished Windows build guide:** [v0.7.0-beta.1 local EXE verification](V07_LOCAL_BUILD_READINESS.md). The guide builds and verifies local Setup and Portable binaries without real Codex inference, installing Setup, GitHub Actions, or publishing a release.

## Go / No-Go

**Current decision: NO-GO for a v0.7 EXE release.** The real App Server check is incomplete; real approvals, Windows binary builds, packaged dependency licensing, notifications, VM acceptance and signing policy remain gates.

GO requires all relevant real-Codex and Windows acceptance gates to pass, zero unexplained automated failures at the pinned commit, manual privacy and licensing review, and an explicit release decision. Only then merge the single reviewed cumulative diff to main, version the complete packaging inputs, create tag `v0.7.0-beta.1` and a GitHub Release **marked Pre-release**, attach fresh Setup/Portable/SHA256SUMS.txt, check downloaded SHA-256, and publish bilingual notes. No EXE in Git; no GitHub Actions without a separate budget approval.

See [Issue #1](https://github.com/morio-23/codex-inventory/issues/1), [Issue #6](https://github.com/morio-23/codex-inventory/issues/6) and [publication policy](PUBLICATION_CHECKLIST.md).
