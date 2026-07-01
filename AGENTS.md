# RawEngine Agent Instructions

Rules for RawEngine's RapidRaw fork.

## Mission

Work toward the macOS-first Capture One/Lightroom-class editor in
`RAW_EDITOR_PLAN.md`; never redefine success around a smaller slice. Prefer
vertical product PRs; planning, schemas, probes, inventories, reports, routing
checks, CI/tooling, and cleanup only support product slices. Cleanup and
CI/tooling PRs must not outnumber feature PRs. Trust current repo/GitHub state;
if blocked, continue implementation, validation, issue cleanup, or PR care.

## Output, Search, And Edits

Keep thread, command, hook, poll, and validation output compact: summarize
success; on failure show the failing step, short excerpt, and next action. Avoid
full logs, JSON, long lists, repeated green output, and unchanged status.
Preserve validation commands, runtime proof, blockers, and consult decisions.

Keep searches repo-scoped. Use `rg` for text/files, `sg` for structural
search/rewrites. Exclude dependency/build/cache paths unless needed. Prefer
bounded output (`sed`, `head`, `tail`, `rg -l`, `rg --count`, `jq`). Use
`apply_patch` for manual edits and Bun for TS/React package work. Do not use
AppleScript, `osascript`, System Events, JavaScript from Apple Events, or Apple
Events automation unless permitted.

## Repo, Worktrees, And PRs

Start each turn/worktree with compact preflight: repo root, branch/worktree,
deps, remotes, GitHub repo, and open PR count. Fix failures first.
`gh repo view --json nameWithOwner --jq .nameWithOwner` must be
`cgasgarth/RapidRaw`; otherwise run `bun run repo:fix-gh-resolution`. Remotes:
`origin=https://github.com/cgasgarth/RapidRaw.git`,
`upstream=https://github.com/CyberTimon/RapidRAW.git`. Create worktrees
with `bun run worktree:create -- --branch codex/name`; fix that helper if setup
is missing.

Keep at most four active PRs. Check the queue before opening one; every PR needs
merge, fix, close, or deferral. Do not leave PRs stale, or rebase/force-push
healthy PRs only waiting for checks unless behind/conflicting/required. Enable
auto-merge when safe. Never push to protected `main`. Before publishing, remove
anything that would make a reviewer ask "what is this doing here?": stray files,
scripts, reports, artifacts, helper indirection, weak tests, generated
inventory/report JSON, or agent-workflow scripts.

## Scripts, Tooling, And Types

Do not add per-test/per-proof `package.json` aliases. Scripts stay
suite/workflow-level (`test`, `check`, `lint`, `format`, `build`,
`check:schema`, `check:bundle`, Rust gates, app launchers, worktree setup). Run
individual checks directly. Do not add custom scripts when standard tooling
handles the job; prefer deleting indirection.

Reject package-script bloat, inventory/report churn, metadata-only tests,
wiring-only tests, and validation IDs masquerading as commands. Keep TS/lint
strict. No `as any` or `as unknown as`. Use Zod for TS-facing runtime schemas
and config. Track current stable packages/tools; major or semver-risky bumps
need dedicated issues.

## Tests And Validation

Tests prove product logic or user journeys: Bun test for non-UI TS, Playwright
or native app automation for UI/e2e, Cargo test for Rust. Do not test script
text, hook wiring, workflow strings, generated inventories, command names, or
agent metadata. Delete weak `tests/integration/checks/check-*.ts` files. New
integration/runtime/fixture/E2E checks belong in `tests/integration/checks/`;
keep `scripts/` for helpers, generators, CI classifiers, and wrappers.

Before push/PR, stage intended files and try the commit so precommit runs. Fix
failures and retry. Bypass hooks only if the user paused local validation, then
say hosted CI is the source. Extra validation should prove runtime,
preview/export, UI, or image-output behavior beyond precommit. If GHA exposes
deterministic repo failures, add/update the cheapest local gate unless covered.

Match proof to claim: plan-only, schema-only, API-only, dry-run-only, UI-only,
and runtime-capable are distinct. Do not call a feature complete until runtime,
preview/export, E2E/equivalent proof, screenshots/artifacts, and gaps are proven
or tracked. Image features require app execution on RAWs and output validation.
Prefer `/Users/cgas/Pictures/Capture One/Alaska`; never commit private RAWs or
artifacts. Use one private-root/report pattern. Use Computer Use for visible UI
claims; prefer `bun run install:computer-use` for `/Applications/RapidRAW.app`.

## Issues, Consult, And Subagents

Issues are one-PR delegation packets where practical, with concise `Why`, `How`,
`Validation`, intent, constraints, links/artifacts, runtime proof, and plan-only
status as needed. Use milestones for themes. Split broad issues, close stale or
duplicate work, and keep backlog for parallel streams.

Use consult at milestone level before creating/materially reshaping a milestone.
Ask for goal, architecture, sequence, risks, validation, and PR-sized issues;
pass milestone titles/numbers and, when available, ask consult with GitHub
connector to create/assign issues. Do not consult per PR by default; reconsult
only when scope, risk, UI, science/math, architecture, or validation changes.

Use consult heavily for design, color science, negative processing, film sims,
deblur, denoise, detail math, panorama, HDR, focus stacking, super-resolution,
app-server/agent architecture, GHA, and tricky UI. For science/math image work,
iterate through consult, math/alternatives, fixtures/metrics, runtime
implementation, preview/export parity, and real image proof. RapidRaw consults
use the RapidRaw ChatGPT project with `cgasgarth/RapidRaw` data when available.
Start with concrete context; do not add labels such as "new topic."

Main agent acts as engineering manager: select tasks, judge design, review,
integrate, merge, and accept/reject output. Keep at least two PR-bound streams
active when independent work exists. Use subagents/worktrees for implementation,
validation, CI diagnosis, issue refinement, backlog cleanup, polling, or PR
monitoring. Delegate clear outputs only. PR-sized issues may be subagent-owned
end to end. Do not allow broad PRs, meta-tooling churn, or feature completion
without runtime/product proof.

## Main And CI

Maintain the stable `PR CI / required` aggregate gate and supported GitHub
Actions versions. New `main` or PR workflow runs should not cancel older runs.
