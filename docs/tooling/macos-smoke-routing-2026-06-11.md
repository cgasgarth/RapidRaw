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

## Validation

Run this command before merging routing changes:

```sh
bun run check:ci-paths
```
