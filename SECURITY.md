# Security Policy

**Language: English | [日本語](SECURITY.ja.md)**

Codex Inventory operates on the user's own computer and can request permission to run commands or modify project files via a separate Codex App Server process. Please treat authorization and the local HTTP API as security-sensitive components.

## Supported versions

Security fixes currently target the latest development branch and the most recent explicitly supported beta release, once one is published. The v0.6 beta release process is still under validation; no public binary is declared supported until its release notes say so.

## Reporting vulnerabilities

Please do **not** include exploit details, access tokens, screenshots of real conversations, or private paths in a public GitHub Issue.

Use GitHub's **Report a vulnerability** feature if private vulnerability reporting is enabled for the repository. If it is not available, contact the maintainer privately through their GitHub profile and request a secure reporting channel.

A useful report includes affected commit/version, the security impact, a minimal non-destructive reproduction using dummy files, and any mitigations already tried. Please allow time for triage before public disclosure.

## Security boundaries and limitations

- The app is intended for **127.0.0.1 use only**. Never expose its HTTP port through a reverse proxy, tunnel, port forwarding or a public interface.
- Local HTTP endpoints do not implement user authentication; a different process running as the same OS user may not be fully isolated from them. A same-origin check is not equivalent to local process authentication.
- App Server permissions must be reviewed before approval. Commands, directory changes, and network requests may have effects outside the app.
- The app does not bundle the Codex CLI or copy the user's ChatGPT/Codex credentials into release artifacts. Keep local account files private.
- Reset-credit use is irreversible; automation must use mock credits only.
- Official OpenAI service limitations and usage quotas still apply. This independent project is not an OpenAI product.

See [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) ([日本語](RELEASE_ACCEPTANCE.ja.md)) for the Windows verification checklist.
