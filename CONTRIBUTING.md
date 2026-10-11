# Contributing to Codex Inventory

**Language: English | [日本語](CONTRIBUTING.ja.md)**

Thanks for considering a contribution. Codex Inventory is an **independent, unofficial** local desktop client for Codex App Server, not an OpenAI product.

## Before opening a pull request

- Open an Issue first for a large change or a behavior/security change.
- Keep changes focused. Include a reproduction for bugs, relevant tests, and screenshots for UI changes.
- Never include API keys, account credentials, personal Codex history, private project files, real reset-credit identifiers, or files from your user profile.
- Use a throwaway test project and mock App Server for automated tests. Do not consume actual reset tickets.
- Be respectful in discussions and issue review.

## Local development

Prerequisites: Node.js 20+ (Node 22 recommended), npm, and Playwright Chromium for browser tests. Windows 11 x64 is required for the desktop packaging scripts.

~~~bash
npm ci
npx playwright install chromium
npm run check
npm test
npm run test:e2e
~~~

For Windows builds, see [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md). Tests requiring a real authenticated Codex CLI are **opt-in** and may use quota. Follow the [release acceptance checklist](RELEASE_ACCEPTANCE.md) (also [日本語](RELEASE_ACCEPTANCE.ja.md)). Additional Windows release gates are documented in [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md).

## Pull request expectations

Describe what changed, why, how you verified it, and what remains untested. In particular, include before/after screenshots at narrow and desktop widths for visual changes. A successful mock test does not by itself establish Windows installer, real authorization, or notification center compatibility.

By submitting a contribution, you agree that your contribution can be included under this repository's [MIT License](LICENSE). If part of your contribution contains third-party material, identify its source and license and ensure that you have the right to contribute it.

## Vulnerability reports

**Do not disclose an exploitable security issue in a public Issue.** Use GitHub's private vulnerability reporting for this repository if it is enabled, or contact the maintainer privately through their GitHub profile. Include minimal steps to reproduce and avoid attaching real credentials. See [SECURITY.md](SECURITY.md).

### Git author privacy
If you do not wish to disclose your email address, configure Git's `user.email` to your GitHub-provided noreply address **before creating a commit**. GitHub may retain metadata from rewritten commits and PR force-pushes. Always check `git var GIT_AUTHOR_IDENT` and `git var GIT_COMMITTER_IDENT` before publishing.
