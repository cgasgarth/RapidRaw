# Staged Hook Checks

Issue: #41

The repo-managed pre-commit hook now runs fast checks against staged files after
blocking direct commits on `main`.

## Command

```sh
bun lint-staged --quiet
```

The command uses `lint-staged` to run changed-file scoped checks:

- Prettier write on staged files with supported formatter extensions.
- ESLint `--fix` with `--max-warnings 0` on staged JavaScript and TypeScript
  files.
- i18n extraction, dry-run verification, and linting when source or locale
  files change.

## Activation

```sh
bun run hooks:install
```

The hook is intentionally changed-file scoped so commits are not blocked by
unrelated baseline files.

Hook output is compact by default through `lint-staged --quiet`.
