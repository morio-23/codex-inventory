## What changed / 変更内容

Describe the change and user impact. / 変更内容と利用者への影響を説明してください。

## Local verification / ローカル検証

GitHub Actions does not run automatically due to runner budget. **Local PASS is not GitHub Actions PASS.**
GitHub Actionsは予算のため自動起動しません。**ローカルPASSはActionsのPASSではありません。**

- [ ] npm run check (PASS / FAIL / SKIP)
- [ ] npm test (pass: __ / fail: __ / skip: __)
- [ ] npm run test:e2e (pass: __ / fail: __ / skip: __)
- [ ] Relevant manual checks / 必要な実機・目視確認
- [ ] Existing behavior and Japanese/English UI / 既存動作と日英UIに影響がないこと

Test OS / Node version / Commit SHA:

## Privacy and release safety / 公開時の安全性

- [ ] No credentials, user history, private paths, unsanitized screenshots, or binaries are committed
- [ ] 認証情報・私的会話・非公開パス・匿名化前画像・EXEをコミットしていない
- [ ] Any skipped real Codex test is declared; real reset credits were not automatically consumed
- [ ] 実CodexテストのSKIPを明記し、実リセットチケットは自動消費していない

## Remaining work / 未検証・既知の制限

List any unverified behavior, especially Windows installer or native notifications.
