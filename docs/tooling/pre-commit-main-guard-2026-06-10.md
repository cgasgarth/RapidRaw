# Pre-Commit Main Guard

Issue: #39

RawEngine blocks local commits made directly on `main`. The guard lives in the
repo-managed `.githooks/pre-commit` hook and is activated by pointing Git at the
repo hook directory.

## Install

```sh
bun run hooks:install
```

## Verify

```sh
bun run hooks:verify
```

## Behavior

- Commits on `main` fail before the commit is created.
- Commits on feature branches continue.
- Detached HEAD states continue, because release and bisect workflows can use
  detached checkouts.
- Staged lint/format checks are intentionally not part of this hook yet; they
  are tracked by #41.

The hook error is:

```text
Direct commits on main are blocked. Create a feature branch and open a PR.
```
