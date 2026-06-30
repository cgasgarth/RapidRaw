# Bun CI And Script Migration

- Date: 2026-06-10
- Issue: #22 `tooling(bun): migrate frontend CI install and script execution to Bun`
- Branch: `codex/migrate-frontend-ci-to-bun`

## Purpose

#21 made Bun available without forcing every existing command path through it.
This follow-up moves the compatible frontend validation and app build paths to
Bun while keeping inherited non-macOS packaging behavior tracked separately.

## Changes

- Frontend validation jobs in `.github/workflows/lint.yml` use
  `oven-sh/setup-bun@v2`.
- Frontend validation jobs install with `bun install --frozen-lockfile`.
- Frontend validation jobs run scripts with `bun run ...`.
- Reusable app builds install frontend dependencies with
  `bun install --frozen-lockfile`.
- Android packaging invokes the local Tauri CLI through `bun run tauri`.
- Android release asset version extraction reads Tauri config through `bun
--print`.
- Tauri `beforeDevCommand` and `beforeBuildCommand` now use `bun run dev` and
  `bun run build`.
- `docs/tooling/local-checks/rapidraw-script-entrypoints-2026-06-10.md` now records Bun as
  the frontend CI source of truth.

## Documented Exceptions

- Android matrix review remains deferred to #52, but project-authored Android
  workflow helper commands now run through Bun.

## Local Validation

Passing checks:

```sh
bun install --frozen-lockfile
bun run build
bun run i18n:check
bunx prettier --check .github/workflows/build.yml .github/workflows/lint.yml src-tauri/tauri.conf.json docs/tooling/local-checks/rapidraw-script-entrypoints-2026-06-10.md docs/tooling/bun/bun-ci-script-migration-2026-06-10.md
ruby -e 'require "yaml"; ARGV.each { |p| YAML.load_file(p); puts "YAML parsed: #{p}" }' .github/workflows/build.yml .github/workflows/lint.yml
git diff --check
bun tauri --version
bun tauri build --verbose --target aarch64-apple-darwin --bundles app
```

Expected baseline failures:

```sh
bun run typecheck
bun run lint
bun run format:check
bun run i18n:lint
```

These remain non-blocking in CI and are tracked by #283, #286, #289, and #285.

## Local DMG Caveat

`bun tauri build --verbose --target aarch64-apple-darwin` compiled the app but
failed in the local DMG packaging step after Tauri's DMG helper invoked
`/usr/bin/osascript` and Finder timed out. That local DMG path is not suitable
under this workspace's no-AppleScript rule. Use app-only local smoke builds and
GitHub Actions macOS packaging for DMG validation.
