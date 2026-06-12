# macOS Smoke Routing

Issue: #524

## Contract

The PR gate should start all independent checks in parallel, but the expensive
macOS no-bundle app smoke should run only when changed paths can affect the
packaged macOS application or repository automation.

## Safe Tooling Paths

These paths are covered by faster validation gates and do not need the app smoke
by themselves:

- `eslint.config.js`
- `i18next.config.ts`
- `scripts/*.mjs`

Build, package manager, workflow, action, Rust, Tauri, unknown, and mixed
safe/required path changes still require the macOS smoke.

## Smoke Toolchain Setup

The macOS no-bundle smoke installs `aarch64-apple-darwin` through
`actions-rust-lang/setup-rust-toolchain` with `rust-src-dir: src-tauri`. The
setup action cache is disabled there because the job already owns an explicit
`Swatinem/rust-cache` step with a smoke-specific key. Keep that single cache
path unless the smoke cache contract changes.

## Validation

Run this command before merging routing changes:

```sh
bun run check:ci-paths
```
