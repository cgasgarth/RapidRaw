# Markdown Link Checks

Issue: #46

RawEngine validates documentation with a local command so PR authors and CI use
the same path.

## Command

```sh
bun run docs:check
```

This command runs Prettier's Markdown formatter in check mode and then validates
internal Markdown links with `tests/integration/checks/check-markdown-links.ts`.

## Scope

- Relative Markdown links and image targets must resolve to files or
  directories inside the repository.
- Markdown heading anchors are validated for links to local `.md` files.
- External URLs are skipped for now to avoid rate-limit and network-flake noise
  in the baseline gate.

## CI

`.github/workflows/lint.yml` runs `docs: markdown and links` as an independent
job and includes it in `PR CI / required`.
