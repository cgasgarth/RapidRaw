# RapidRaw QA harness

The QA harness runs independently registered browser scenarios against one Vite server and one Chromium process. Every scenario gets a fresh browser context, explicit fixture setup, an isolated artifact path, and a standalone failure receipt.

```bash
bun qa run --scenario browser.editor.compare
bun qa run --tag crop --shard-index 0 --shard-total 2
bun qa impacted --base origin/main
bun qa --list
```

The registry lives in `scripts/qa/scenarios.ts`. Scenario order is not state: each implementation establishes its declared empty, library, or editor fixture itself. Shards sort IDs before partitioning so the same index and total always select the same scenarios.

Receipts under `private-artifacts/qa/<run>/run.json` bind results to the Git SHA, dirty-worktree digest, worktree path, Bun lock/build identity, browser/platform, shard, durations, screenshots, and exact rerun command. Private artifacts are never committed.

The native QA launcher separately hashes native, frontend, bundle configuration, scenarios, features, and worktree identity. Scenario-only changes avoid rebuilding, copying, and signing. Frontend-only changes can reuse a validation-harness app with `--dev-server`; native, bundle, feature, or worktree changes force isolated deployment. `--clean` preserves full release-style proof.

CI remains deterministic: omit watch/headed options and select explicit scenarios or shards. Unknown changed paths conservatively select all scenarios; recognized compare, crop, negative-lab, global UI, Tauri, or dependency changes select their owned scenario tags.
