# Codex Inventory vX.Y.Z — Release notes (English)

**Language: English | [日本語](RELEASE_NOTES_TEMPLATE.ja.md)**

> Template only. **Do not publish** until the release acceptance checklist passes and the release owner approves the assets.

## What's new

- [Feature / fix] — [user-visible impact]
- [Feature / fix] — [user-visible impact]

## Download (Windows 11 x64)

Attach these files to the matching **GitHub Release**, not to Git commits:

- CodexInventory-Setup-X.Y.Z-x64.exe — installer
- CodexInventory-Portable-X.Y.Z-x64.exe — no installation required
- SHA256SUMS.txt — SHA-256 of the exact uploaded executables
- Third-party copyright/license notices — when required by the distributed dependencies

Download only from [GitHub Releases](https://github.com/morio-23/codex-inventory/releases). Do not substitute EXEs from older builds. Match the hash after download.

## Requirements and installation

Windows 11 x64 and a compatible authenticated Codex CLI/App Server binary. The Desktop EXE itself does not require Node.js on the target computer. The Codex CLI and login credentials are **not bundled**. Use the installer or run Portable directly; follow the on-screen CLI detection/login guidance.

## Testing and known limitations

- Node tests: [PASS/FAIL, count, date]
- Playwright mock E2E: [PASS/FAIL, count, date]
- Real Codex permission approval/decline: [PASS/FAIL/SKIP, details]
- Setup install/uninstall on disposable VM: [PASS/FAIL/SKIP]
- Portable first-run / second Windows account: [PASS/FAIL/SKIP]
- Windows Notification Center: [PASS/FAIL/SKIP]
- Signature: [Valid publisher name / **Unsigned beta**]
- Package and third-party license review: [complete / pending]
- Known bugs and limitations: [bullet points]

**Security:** Inventory binds its HTTP server to 127.0.0.1. Never expose it through a tunnel or reverse proxy. The local HTTP API does not authenticate other local processes. Review every Codex permission request. Real reset tickets are finite and irreversibly consumed.

## Upgrade and support

No automatic updater is included. Upgrade by installing the next Setup version or replacing the Portable executable. Report bugs via [GitHub Issues](https://github.com/morio-23/codex-inventory/issues); send vulnerabilities privately following [SECURITY.md](SECURITY.md).

This is independent third-party software, not an official OpenAI application. Source is provided under [MIT](LICENSE); third-party components retain their respective licenses.
