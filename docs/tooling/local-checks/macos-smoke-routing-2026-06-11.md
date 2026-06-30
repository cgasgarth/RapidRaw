# macOS Smoke Routing

Issue: #524

## Contract

The PR gate starts fast independent checks in parallel and records which macOS
smoke mode would be required. Expensive macOS Rust checks and the no-bundle app
smoke run on `main` pushes and manual `workflow_dispatch`, not as PR blockers:

- `none`: docs, frontend leaf, fixture docs, and root metadata changes that are
  already covered by faster validation gates.
- `debug`: workflow, action, GitHub automation, lint/tooling config, and
  validation script changes where the app build path should still be exercised
  but a release-style compile is unnecessary.
- `release`: Rust, Tauri, package/build config, lockfile, unknown, empty, and
  mixed debug/release changes. This is the fail-closed path.

## Safe Tooling Paths

These paths are covered by faster validation gates and do not need the app smoke
by themselves:

- `biome.json`
- `i18next.config.ts`
- `scripts/*.ts`

Build, package manager, workflow, action, Rust, Tauri, unknown, and mixed
safe/required path changes still record a fail-closed smoke decision in PRs.
The actual long macOS smoke runs after merge on `main` and can be launched
manually before merge when a risky change needs extra confidence.

## Smoke Toolchain Setup

The `main`/manual macOS no-bundle smoke installs `aarch64-apple-darwin` through
`actions-rust-lang/setup-rust-toolchain` with `rust-src-dir: src-tauri`. The
setup action cache is disabled there because the job already owns an explicit
`Swatinem/rust-cache` step with a main-smoke key. Keep that single cache path
unless the smoke cache contract changes.

## Validation

Run this command before merging routing changes:

```sh
bun run check:ci-paths
```
