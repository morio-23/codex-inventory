# Codex Inventory v0.7.0-beta.1 — Release notes (UNPUBLISHED DRAFT)

> **Do not ship.** Release gates incomplete as of October 23, 2026. Do not invent binary URLs, hashes, or test outcomes.

## What's new
- Two independent chat panes with separate drafts, transcript, send/interrupt, model and reasoning effort.
- Minecraft-inspired bottom-left activity feed for background chats; notifications are designed not to expose prompts, command output, or internal IDs.
- Scoped cross-workspace send, interrupt and approvals, with reconnect and stale-event protections.
- EN/JA interface, adjustable divider and compact-width pane switching.

## Outstanding release blockers
- The October 14 real App Server read-only smoke halted on CONFIG_WARNING; empty-history and genuine approval flow remain unverified.
- Latest-commit Node/Playwright checks, fresh Windows Setup/Portable builds, disposable VM acceptance are not complete.
- Dependency notices, packaging inspection, native notification behavior, and manual repository/image privacy reviews remain to be done.

## Release fields (populate only after acceptance)
- Candidate tag: `v0.7.0-beta.1` (not created)
- Setup/Portable: not built or published
- SHA-256: unknown
- Authenticode: not checked (document SmartScreen if unsigned)
- Final test results: not run on the release candidate
- Download URLs: unavailable

**Safety and scope:** Independent, unofficial MIT OSS. Codex CLI, login, credits and credentials are not bundled. Never expose the local HTTP API via a tunnel. Users must review permission prompts; commands and file changes can affect their workspaces.

See [v0.7 readiness gates](V07_RELEASE_READINESS.md).
