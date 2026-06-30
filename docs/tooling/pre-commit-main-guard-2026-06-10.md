# Pre-Commit Main Guard

Issue: #39

RawEngine blocks local commits made directly on `main`. The guard lives in the
repo-managed `.githooks/pre-commit` hook and is activated by pointing Git at the
repo hook directory.

## Install

```sh
bun run hooks:install
```

## Behavior

- Commits on `main` fail before the commit is created.
- Commits on feature branches continue.
- Detached HEAD states continue, because release and bisect workflows can use
  detached checkouts.
- The hook runs `bun run lint:fix`, stages autofixes with `git add -u`, then
  runs the standard local lint, format, typecheck, test, Rust, bundle, i18n,
  unused dependency, docs, schema, and schema-routing gates in parallel.

The hook error is:

```text
Direct commits on main are blocked. Create a feature branch and open a PR.
```
