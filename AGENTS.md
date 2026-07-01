# RawEngine Agent Instructions

These instructions apply to the RapidRaw fork used for RawEngine work.

## Operating Defaults

- Work toward the full macOS-first Capture One/Lightroom-class RAW editor in
  `RAW_EDITOR_PLAN.md`; do not redefine success around a smaller slice.
- Inspect current repo/GitHub state before relying on older context. If one
  area blocks, continue useful implementation, validation, issue cleanup, or PR
  maintenance.
- Keep searches repo-scoped. Use `rg` for text/files and `sg` for syntax-aware
  search or rewrites, for example `sg --lang <language> -p '<pattern>'`.
- Exclude dependency/build/cache paths such as `node_modules`, `dist`, `target`,
  `src-tauri/target`, plugin caches, and `~/.codex` unless explicitly needed.
- Prefer bounded `sed`/`head`/`tail`, `rg -l`, `rg --count`, `jq` summaries, and
  compact command wrappers over broad dumps.
- Use `apply_patch` for manual edits. Use Bun for TypeScript/React package
  management, scripts, tests, CI, and one-off JS/TS commands where applicable.
- Do not use AppleScript, `osascript`, System Events GUI scripting, JavaScript
  from Apple Events, or Apple Events automation unless the user explicitly
  permits that task.

## Compact Output

- Keep command, hook, poll, validation, and thread output compact. On success,
  summarize; on failure, include the failing step, short actionable excerpt, and
  next action/blocker.
- Do not dump full logs, JSON, long file lists, repeated green output, or
  unchanged PR/CI/branch/status blocks unless needed for the next decision.
- Preserve hard evidence: exact validation commands, runtime proof, blockers,
  safety decisions, and accepted/rejected consult advice. Prefer updating
  existing issues, docs, plans, and PR descriptions over duplicated summaries.

## Startup And Repo Resolution

- In each new turn or worktree, do one compact preflight: repo root,
  branch/worktree state, dependency availability, remotes, GitHub repo
  resolution, and open PR count. Fix preflight failures before feature work.
- Keep `gh` resolved to `cgasgarth/RapidRaw`. If
  `gh repo view --json nameWithOwner --jq .nameWithOwner` returns anything
  else, run `bun run repo:fix-gh-resolution` rather than adding repeated `-R`
  flags.
- Intended remotes: `origin=https://github.com/cgasgarth/RapidRaw.git` and
  `upstream=https://github.com/CyberTimon/RapidRAW.git`; `origin` is the
  gh-resolved base remote, `upstream` is not.
- Use the checked-in Codex local environment when available. Create new Codex
  worktrees with `bun run worktree:create -- --branch codex/name` or validate
  with `--dry-run`; fix that helper if recurring setup needs are missing.
- Do not add or preserve repo scripts whose main purpose is agent workflow.

## Pull Requests

- Keep at most four active open PRs. Before opening one, check the queue with
  `gh`; every open PR needs a disposition: merge, fix, close, or explicit
  deferral.
- Do not leave PRs stale. Do not rebase/force-push a healthy PR that only awaits
  checks unless it is behind/conflicting or branch protection requires it. Enable
  auto-merge when checks are running/passing and no blockers remain.
- Before publishing, do a human-cleanliness pass: remove any file, script,
  report, artifact, helper indirection, or test that would make a reviewer ask,
  "what is this doing here?"
- Prefer vertical product feature PRs. Planning, schemas, probes, inventories,
  reports, routing checks, CI/tooling, and cleanup only support product slices;
  cleanup/CI/tooling PRs must not exceed feature PRs.
- Avoid meta-tooling unless it clearly improves product quality or prevents a
  recurring real failure. Proof scripts belong in the feature PR they validate.
- Avoid committed generated inventory/report JSON unless required for a product
  validation gate or deliberate human-review artifact. Clean up slop before
  building on it.

## Package Scripts And Tooling

- Do not add per-test or per-proof aliases to `package.json`. Package scripts
  must stay suite-level or user-facing workflow-level commands (`test`, `check`,
  `lint`, `format`, `build`, `check:schema`, `check:bundle`, Rust gates, app
  launchers, worktree setup). Run individual checks with direct native commands.
- Do not add custom scripts when a standard package, native runner, shell
  command, GitHub Actions feature, Bun/Cargo/Playwright capability, or existing
  helper cleanly handles the job. Prefer deleting custom indirection.
- PR review must reject package-script bloat, inventory/report churn, tests that
  only assert metadata or wiring, and validation IDs masquerading as commands.
- Keep TypeScript and linting strict. Do not introduce `as any` or
  `as unknown as`. Use Zod for TypeScript-facing runtime schemas and structured
  config validation.

## Testing And Validation

- Tests should prove product logic or user journeys. Use Bun test for non-UI
  TypeScript logic, Playwright or native app automation for UI/e2e journeys, and
  Cargo test for Rust.
- Do not create tests whose main value is package script text, hook wiring,
  workflow strings, generated inventories, command names, or agent/process
  metadata. Do not wrap policy probes, schema-only checks, inventory scans, or
  config assertions in `.test.ts` to make them look like product tests.
- Delete or simplify stale `tests/integration/checks/check-*.ts` files that do
  not validate runtime behavior, source logic, or real user workflow. Do not
  build more checks on weak checks.
- New integration, validation, runtime-proof, fixture-proof, and E2E-style
  checks belong in `tests/integration/checks/`; keep `scripts/` for reusable
  helpers, generators, CI classifiers, and command wrappers.
- Before push or PR creation, stage intended files and try the commit so the
  precommit hook runs. Fix reported issues and retry. Do not bypass hooks unless
  the user explicitly paused local validation; then state that hosted CI is the
  validation source.
- Run extra focused validation only when it proves changed runtime,
  preview/export, UI, or image-output behavior that precommit cannot cover, and
  record those commands as PR evidence.
- Do not wait for CI to find basic format, lint, i18n, missing dependency, or
  bundle-budget failures. If GitHub Actions exposes a deterministic repo issue,
  add or update the cheapest local/precommit gate unless that failure class is
  already covered.
- Match validation scope to the claim. Treat plan-only, schema-only, API-only,
  dry-run-only, UI-only, and runtime-capable work as distinct completion states.
- Do not close or describe a feature as complete until runtime behavior,
  preview/export behavior, E2E or equivalent workflow proof, screenshots or
  artifacts, and follow-up gaps are proven or explicitly tracked.
- Image-editing features require running the app/software with the new feature
  on RAW images and validating output images or artifacts. Schemas, dry-runs,
  synthetic fixtures, and UI smoke checks are intermediate proof only.
- For private RAW/image work, prove real runtime output behavior. The user has
  allowed validation with their RAW files under
  `/Users/cgas/Pictures/Capture One/Alaska`; do not commit those files or
  generated private artifacts.
- Keep private RAW validation standardized around one reusable private root and
  report pattern. Commit private reports only as deliberate human-review
  artifacts.
- Use Computer Use for local macOS app verification when completing
  user-visible UI or workflow claims. Prefer `bun run install:computer-use` so
  verification attaches to `/Applications/RapidRAW.app`.

## GitHub Issues And Backlog

- New issues should be delegation packets sized for one small/medium PR where
  practical, with product intent, ownership, constraints, and validation
  evidence needed to branch, implement, validate, commit, push, and open a PR.
- Issue bodies need concise `Why`, `How`, and `Validation` sections with enough
  links, checks, artifacts, runtime proof, or plan-only status to avoid
  rediscovery.
- Use milestones for larger themes. After feature PR batches, review the active
  goal and `RAW_EDITOR_PLAN.md`, consult at milestone level, then create/update
  milestones and PR-sized issues.
- Include consult decisions, constraints, validation expectations, and follow-up
  gaps directly in issues. Split broad issues, close obsolete/meta-only or
  duplicate work, refresh stale context, and keep enough backlog for parallel
  workstreams.

## Consult And Research

- Use consult at the milestone level before creating or materially reshaping a
  milestone. Ask for product goal, architecture, sequencing, risks, validation
  strategy, and a PR-sized issue breakdown.
- For milestone GitHub planning, create or confirm milestones first, then pass
  titles/numbers into consult. When the GitHub connector is available, ask
  consult to create or assign PR-sized issues to those milestones.
- Do not consult separately for each PR by default. Reconsult only when scope,
  risk, UI direction, science/math, architecture, or validation strategy
  materially changes.
- Use consult heavily for design decisions, color science, negative processing,
  film simulations, deblur, denoise, sharpening/detail math, panorama stitching,
  HDR, focus stacking, super-resolution, app-server/agent architecture, GitHub
  Actions strategy, and tricky UI architecture.
- For science/math-heavy image features, iterate: consult, define math and
  rejected alternatives, add fixtures/metrics, implement runtime behavior,
  verify preview/export parity, and prove quality on representative real images.
- For RawEngine/RapidRaw consults, start inside the RapidRaw ChatGPT project and
  attach the `cgasgarth/RapidRaw` GitHub repo/app data source when available.
  Record any limitation if the project or data source is unavailable.
- Start consult prompts with the concrete milestone, feature, bug, PR, or
  decision context; do not add meta labels such as "new topic." Treat consult
  as advice and verify it against current repo state before implementing.

## Subagents And Worktrees

- Treat the main agent as engineering manager: own task selection, design
  judgment, review, integration, merge decisions, and acceptance/rejection of
  subagent output.
- Keep at least two PR-bound workstreams active whenever independent useful work
  exists: PRs in CI/review and/or scoped subagent-owned worktrees expected to
  become PRs.
- Use subagents/worktrees for independent implementation, validation, CI
  diagnosis, issue refinement, backlog cleanup, log polling, or PR monitoring
  when this will not create ownership conflicts or reduce review quality.
- Delegate only clear outputs: patch, diagnosis, issue list, validation summary,
  PR, or next action. Straightforward tasks can use a smaller/faster model such
  as 5.4 mini when available.
- PR-sized issues may be owned end to end by subagents: branch, implementation,
  validation, commit, push, PR description, and initial CI follow-up. Use draft
  PRs only for a stated blocker or intentionally incomplete patch.
- Do not let subagents open broad/under-refined PRs, create meta-tooling churn,
  or mark feature work complete without runtime/product proof. While CI runs,
  start/delegate another independent stream or monitor the queue.

## Dependency Freshness

- Track latest stable major/minor versions for JS/Bun packages, Rust crates,
  GitHub Actions, Node, Bun, Tauri, Rust tooling, and validation CLIs.
- Compatible patch/minor refreshes may be grouped after the full validation
  story passes.
- Every discovered major package/tooling bump needs a dedicated issue before
  implementation. Treat Cargo `0.x` semver-incompatible minor or patch jumps as
  major-style migrations.
- Do not hide major migrations inside broad lockfile refresh PRs.

## Main Protection And CI

- Maintain the stable `PR CI / required` aggregate gate and keep GitHub Actions
  on supported major versions.
- New `main` or PR workflow runs should not cancel older validation runs.
- Never push directly to protected `main`; use PRs and the queue discipline
  above.
