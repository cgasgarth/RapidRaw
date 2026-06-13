# Merge Queue Evaluation

Issue: #447 `ci(merge-queue): evaluate merge queue after PR gate is stable`

## Decision

Do not enable GitHub merge queue yet.

The current branch protection model is strong enough for the present single-agent
workflow: `main` requires pull requests, requires the stable aggregate check
`PR CI / required`, requires branches to be up to date through strict required
status checks, blocks force pushes and deletion, and preserves auto-merge after
the gate succeeds.

Merge queue should be revisited after macOS runner latency is consistently lower
and the project has enough concurrent contributor pressure for merge-group
validation to offset the extra queue time.

## Current Repository Readback

Captured on 2026-06-12.

- Repository visibility: public.
- Default branch: `main`.
- Auto-merge: enabled.
- Delete branch on merge: enabled.
- Classic branch protection endpoint: not configured for `main`; protection is
  enforced by repository ruleset.
- Ruleset: `Protect main` (`17485700`).
- Ruleset enforcement: active.
- Ruleset target: `refs/heads/main`.
- Bypass actors: none.
- Preserved rules:
  - deletion blocked;
  - non-fast-forward updates blocked;
  - pull requests required;
  - stale reviews dismissed on push;
  - review thread resolution required;
  - merge, squash, and rebase merge methods allowed.
- Required status checks:
  - strict required status checks policy enabled;
  - required context is exactly `PR CI / required`.

## Stability Evidence

The prerequisites from #447 are satisfied:

- #443 is closed. `PR CI / required` exists as the stable aggregate PR gate and
  has passed repeatedly across follow-up validation PRs.
- #445 is closed. The active `Protect main` ruleset requires `PR CI / required`
  and has no bypass actors.
- Recent PRs merge by auto-merge only after the aggregate gate reports success.

## Latency Finding

At the time of this evaluation, recent `main` branch `Baseline Validation` runs
were queued behind hosted macOS capacity. The ten most recent `main` push runs
for the workflow were still queued when read back, including pushes from #854
through #863.

Merge queue would introduce a merge-group validation run before merge, then the
existing post-merge `main` validation would still run. With the current hosted
macOS queue behavior, that would likely increase wall-clock latency for every
PR without adding enough practical safety to justify enabling it immediately.

## Why Not Enable `merge_group` Now

Adding `merge_group` triggers before enabling a repository merge queue is not
useful. Adding them while the queue is disabled only expands workflow surface
area without exercising the intended path.

The current `Baseline Validation` workflow is also PR-shaped:

- `changed-paths` runs only for `pull_request`.
- changed-file routing reads `github.event.pull_request.number`.
- `PR CI / required` runs only for `pull_request`.

A real merge queue implementation must add a deliberate merge-group routing
path. It should not be a trigger-only PR.

## Future Enablement Criteria

Reconsider merge queue when all of these are true:

- `main` post-merge validation is consistently green for at least 20 consecutive
  merges or one full week of active work, whichever is longer.
- Hosted macOS queue latency is low enough that an additional merge-group run
  does not materially slow small PR throughput.
- Open PR concurrency regularly creates rebase churn, stale required checks, or
  merge-order risk that auto-merge plus strict status checks does not address.
- `PR CI / required` has had no check-name churn for at least one week.
- The changed-path classifier has an implementation plan for `merge_group`
  events that fails closed when file diff discovery is ambiguous.

## Future Implementation Plan

When the enablement criteria are met:

1. Enable merge queue in the `Protect main` ruleset.
2. Add `merge_group` triggers to required validation workflows.
3. Teach changed-file routing to classify merge groups without relying on
   `github.event.pull_request.number`.
4. Run the same required peer jobs for merge groups as ordinary PRs, or fail
   closed when a routing decision cannot be proven.
5. Keep the stable required context `PR CI / required` unless the ruleset update
   PR explicitly coordinates a new required context.
6. Validate with a test PR that enters the queue, waits for merge-group checks,
   merges only after success, and leaves post-merge `main` CI green.
7. Document observed queue latency before and after enablement.

## Current Follow-Up

No workflow changes are required now. The correct action is to keep improving
macOS CI latency, cache hit rate, and path routing before introducing merge
queue.
