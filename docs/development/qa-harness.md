# RapidRaw QA harness

The QA harness runs independently registered browser scenarios against one Vite server and one Chromium process. Every scenario gets a fresh browser context, explicit fixture setup, an isolated artifact path, and a standalone failure receipt.

```bash
bun qa run --scenario browser.editor.compare
bun qa run --persistent --scenario browser.editor.compare
bun qa run --tag crop --shard-index 0 --shard-total 2
bun qa impacted --base origin/main
bun qa reproduce private-artifacts/qa/<run>/run.json
bun qa daemon health
bun qa daemon shutdown
bun qa benchmark --scenario browser.library.open
bun qa native health
bun qa native diagnostics
bun qa native reset empty
bun qa native openFixture /absolute/path/to/image.ARW
bun qa native screenshot /absolute/path/to/private-artifacts/qa/native.png
bun qa native shutdown
bun qa --list
```

The registry lives in `scripts/qa/scenarios.ts`. Scenario order is not state: each implementation establishes its declared empty, library, or editor fixture itself. Shards sort IDs before partitioning so the same index and total always select the same scenarios.

Receipts under `private-artifacts/qa/<run>/run.json` bind results to the Git SHA, dirty-worktree digest, worktree path, Bun lock/build identity, browser/platform, execution mode, seed, shard, durations, and exact rerun command. Failed browser scenarios retain a bounded server log, full-page PNG, Playwright trace, and video; passing scenarios discard trace/video capture. `bun qa reproduce` validates the receipt, rejects another worktree's identity, and reruns failed scenarios (or the full recorded selection when all passed). Private artifacts are never committed.

The native QA launcher separately hashes native, frontend, bundle configuration, scenarios, features, and worktree identity. Scenario-only changes avoid rebuilding, copying, and signing. Frontend-only changes can reuse a validation-harness app with `--dev-server`; native, bundle, feature, or worktree changes force isolated deployment. `--no-build` fails closed when the requested identity needs a rebuild, so it cannot copy or launch a stale bundle. `--clean` preserves full release-style proof. Each run writes a mode-`0600` `private-artifacts/qa/native-deployment.json` receipt with exact identities, elapsed time, reason, and executed or identity-avoided build/copy/sign stages.

CI remains deterministic: omit watch/headed options and select explicit scenarios or shards. Unknown changed paths conservatively select all scenarios; recognized compare, crop, negative-lab, global UI, Tauri, or dependency changes select their owned scenario tags.

`--persistent` starts or reconnects to a worktree-owned daemon through a mode-`0600` Unix socket. The daemon verifies its PID start token and worktree before reuse, keeps one Vite/Chromium lifecycle per configuration identity, warms HMR after source identity changes, and restarts for lock/configuration or headed-mode changes. Every job still receives a fresh context; receipts count created, closed, and leaked contexts. Signals, explicit shutdown, and stale ownership recovery close browser contexts, Chromium, Vite, the socket, and state record.

`bun qa benchmark` executes the same scenario through one-shot, persistent-cold, and persistent-warm modes. It proves result equivalence, balanced context accounting, retained process identities, and a warm edit-to-result budget rather than using a synthetic command. Receipts accumulate server/browser starts and starts avoided, setup and scenario time, serialized worktree wait, artifact bytes, source reuse, restarts, and context leaks.

A native app built with `--features required-ci,validation-harness` can expose a mode-`0600` local control socket when the launcher supplies a random token and exact worktree/build identity. Production binaries omit the module entirely. Every request authenticates the token and repeats the expected identities before it can inspect readiness/capabilities, reset state, open a fixture, inspect revisions, switch cold/warm caches, capture a macOS window PNG, or shut down cleanly. Launch and prove it with:

```bash
bun scripts/dev/start-native-qa-app.ts --validation-harness
bun scripts/qa/prove-native-control.ts --fixture /absolute/path/to/image.ARW
```
