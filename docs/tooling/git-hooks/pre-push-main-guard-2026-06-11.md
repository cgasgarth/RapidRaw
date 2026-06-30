# Pre-Push Main Guard

Issue: #40

The repo-managed `.githooks/pre-push` hook blocks attempted pushes involving
`refs/heads/main`.

The guard rejects:

- pushing local `main` to any remote ref;
- pushing a feature branch or `HEAD` to remote `main`;
- deleting remote `main`.

This local guard complements GitHub branch protection. It is intentionally
limited to ref protection so normal feature-branch pushes stay fast.

## Activation

```sh
bun run hooks:install
```
