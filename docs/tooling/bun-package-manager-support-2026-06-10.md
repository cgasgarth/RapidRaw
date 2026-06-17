# Bun Package Manager Support

- Date: 2026-06-10
- Issue: #21 `tooling(bun): add Bun package manager support`
- Bun version: `1.3.13`
- Repository: `cgasgarth/RapidRaw`

## Purpose

This note records the first Bun package-manager support step for RawEngine. It
adds Bun as a reproducible install path without replacing npm-based scripts or
Tauri commands yet. Full CI/script migration remains #22.

## Changes

- Added `packageManager: "bun@1.3.13"` to `package.json`.
- Generated the text lockfile `bun.lock` from the existing `package-lock.json`.
- `package-lock.json` was later removed after Bun became the repository source
  of truth for frontend installs.
- Added a blocking CI job, `frontend: bun install baseline`, that runs
  `bun install --frozen-lockfile`.
- Added Bun setup to the reusable app-build workflow because Tauri's GitHub
  action detects the package manager and invokes `bun tauri build` when
  `packageManager` points at Bun.

## Source Notes

Official Bun documentation says `bun install --frozen-lockfile` installs exact
versions from the lockfile and exits if `package.json` and `bun.lock` disagree:
<https://bun.com/docs/pm/cli/install>

Official Bun configuration documentation says Bun now generates a text
`bun.lock` by default unless configured otherwise:
<https://bun.com/docs/runtime/bunfig>

## Local Validation

```sh
bun --version
bun install
bun install --frozen-lockfile
bun run build
```

Observed local results:

- `bun --version` returned `1.3.13`.
- `bun install` migrated the lockfile from `package-lock.json` and saved
  `bun.lock`.
- `bun install --frozen-lockfile` checked 402 installs across 483 packages with
  no changes.
- `bun run build` completed successfully with the existing Vite large-chunk
  warning tracked by #288.

## Deferred To #22

- Replace npm CI install paths with Bun where compatible.
- Replace compatible `npm run ...` workflow commands with `bun run ...`.
- Update Tauri `beforeDevCommand` and `beforeBuildCommand` if Bun becomes the
  authoritative frontend runner.
- `package-lock.json` removal is complete; frontend dependency state is
  Bun-only.
