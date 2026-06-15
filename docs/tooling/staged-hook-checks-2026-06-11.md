# Staged Hook Checks

Issue: #41

The repo-managed pre-commit hook now runs fast checks against staged files after
blocking direct commits on `main`.

## Command

```sh
bun run hooks:check-staged
```

The command inspects `git diff --cached --name-only --diff-filter=ACMR` and runs:

- Prettier check on staged files with supported formatter extensions.
- ESLint with `--max-warnings 0` on staged JavaScript and TypeScript files.

## Activation

```sh
bun run hooks:install
bun run hooks:verify
```

The hook is intentionally changed-file scoped so commits are not blocked by
unrelated baseline files.

Hook output is compact by default. Successful commits print only a short staged
summary, while failures keep bounded head/tail output for the failing command.
