# RawEngine Agent Instructions

These instructions apply to the RapidRaw fork used for RawEngine work.

## Long-Running Goal

- Keep the active RawEngine/RapidRaw implementation goal intact. Do not redefine
  success around a smaller subset of work.
- Make concrete progress toward the full macOS-first Capture One/Lightroom-class
  RAW editor described in `RAW_EDITOR_PLAN.md`.
- Work from current repo and GitHub state. Inspect before relying on older
  context.
- If one part blocks, continue other useful implementation, validation, issue
  cleanup, or PR maintenance instead of stopping.

## Pull Requests

- Max two active open PRs total.
- Before opening a PR, run `bun run check:agent-pr-queue`.
- Every open PR must have a disposition: merge, fix, close, or explicitly
  preserve as deferred.
- Do not leave PRs open for hours without checking status and taking the next
  action.
- Do not rebase or force-push a healthy PR that is only waiting on required
  checks unless it is behind/conflicting or branch protection requires it.

## Startup Preflight

- Before implementation in a new turn or worktree, run
  `bun run check:agent-preflight`.
- The preflight must verify repo root, deps/tools, GitHub repo resolution,
  remotes, branch/worktree state, and current open PR count.
- If preflight fails, fix that before feature work.

## GitHub Issues

- Every new GitHub issue should be refined enough for one small or medium PR
  where practical.
- Use milestones to group larger themes instead of making one issue represent
  several PRs.
- Issue bodies should include `Why`, `How`, and `Validation` sections. Keep them
  concise, but include enough context, links, expected checks, screenshots,
  artifacts, runtime proof, or explicit plan-only status for the next agent to
  understand the goal without rediscovering intent.

## GitHub Repo Resolution

- Keep GitHub CLI repo resolution pointed at the fork:
  `cgasgarth/RapidRaw`. If `gh repo view --json nameWithOwner --jq
.nameWithOwner` returns anything else, run `bun run repo:fix-gh-resolution`
  instead of working around it with repeated `-R` flags.
- The intended local remotes are `origin=https://github.com/cgasgarth/RapidRaw.git`
  and `upstream=https://github.com/CyberTimon/RapidRAW.git`; `origin` should be
  the gh-resolved base remote and `upstream` should not be gh-resolved.

## Concise Output Discipline

- Keep thread replies tight, but not cryptic. If `0%` is default verbosity and
  `100%` is maximum compression, target about `65%` efficiency: concise status,
  clear next action, and enough context to follow the work.
- Keep routine command, script, hook, poll, and validation output compact by
  default. This is standing project guidance; do not remove it during cleanup.
- Skip obvious narration and do not repeat the same PR queue, CI, or branch facts
  unless something changed.
- Do not repeat unchanged status summaries in thread updates. Only restate
  command or CI state when it changed, unblocked work, proved a fix, or exposed
  a blocker.
- Summarize tool output only when it changes the next action, proves validation,
  or explains a blocker.
- Use concise conventional commit subjects. Add commit bodies only when the
  reasoning is not obvious from the diff or linked issue.
- Preserve hard evidence. Exact validation commands, runtime proof, blockers,
  safety decisions, and accepted or rejected consult advice must remain visible
  even when other prose is compressed.
- Prefer updating existing issues, docs, plan entries, and PR descriptions over
  adding new duplicated summaries.
- Keep command, script, hook, poll, and validation output token-cheap by default.
  On success, print only compact summaries. On failure, include the failing step,
  a short actionable excerpt, and the next action or blocker.
- Do not emit full logs, full JSON, long file lists, repeated green output, or
  unchanged status blocks unless they are needed for the next decision.
- For commonly used commands, prefer package scripts or wrappers that keep
  normal success output small and bound failure output.

## Consult And Research

- Use the consult skill heavily for design decisions, color science, negative
  processing, film simulations, deblur, denoise, sharpening/detail math,
  panorama stitching, HDR, focus stacking, super-resolution, app-server/agent
  architecture, GitHub Actions strategy, and tricky UI architecture.
- Use Computer Use for local macOS app verification when completing
  user-visible UI or workflow claims. Run the app locally when practical,
  inspect the actual UI, verify it is good-looking, intuitive, and functional,
  and fix or track anything that fails.
- For science/math-heavy image features, iterate rather than claiming maturity
  in one PR: consult first, define the math and rejected alternatives, add
  fixtures/metrics, implement runtime behavior, verify preview/export parity,
  then prove quality on representative real images before closing runtime
  feature issues.
- When using consult for repo-aware decisions, prefer the RapidRaw ChatGPT
  project with the GitHub repo attached when available.
- Treat consult output as advice. Verify it against current repo state before
  implementing.

## Validation And Quality

- Shift left as much as practical: prefer local checks, scripts, schemas,
  fixtures, and CI gates that catch mistakes before manual review.
- Use Bun for TypeScript/React package management, scripts, tests, and CI where
  applicable.
- Prefer Bun over inline Node commands when the task can be expressed as a repo
  script or Bun script.
- Keep TypeScript and linting strict. Do not introduce `as any` or
  `as unknown as`.
- Use Zod for TypeScript-facing runtime schemas and structured config validation.
- Run focused local validation before opening PRs and record evidence in the PR.
- Before push or PR creation, run `bun run check:current-pr-local` or the same
  standard local PR lane manually:
  touched-file format/lint where applicable; typecheck/schema checks when
  TypeScript or schema files changed; i18n check/lint when UI strings changed;
  focused feature scripts; bundle budget when frontend bundle-impacting code
  changed.
- Do not wait for CI to discover basic formatting, lint, i18n, missing
  dependency, or bundle-budget failures.
- Do not treat narrow checks as proof of broad behavior. Match validation scope
  to the requirement being claimed.
- Treat plan-only, schema-only, API-only, dry-run-only, UI-only, and runtime
  apply-capable work as distinct completion states. Do not close or describe a
  full feature as done until runtime behavior, preview/export behavior, E2E or
  equivalent workflow coverage, screenshots or artifacts, and follow-up gaps are
  all proven or explicitly tracked.
- For image-editing features, completion validation must include actually
  running the app/software with the new feature on RAW images and validating the
  output image or generated artifacts. Schemas, dry-runs, synthetic fixtures, or
  UI-only smoke checks are useful intermediate proof, but they are not enough to
  close a feature as complete.
- Do not count planning, schema, API, or UI-only work as a complete feature
  unless end-to-end workflow proof exists in the same PR. If E2E proof is not
  included, state the runtime status explicitly and keep or create a follow-up
  issue for E2E validation.
- Keep frequently reused local checks and hooks token-efficient. On success,
  prefer compact summaries over full command/file lists; on failure, preserve
  actionable tool output.
- Put new integration, validation, runtime-proof, fixture-proof, and E2E-style
  checks in `tests/integration/checks/`. Keep `scripts/` for reusable helpers,
  generators, CI classifiers, and command wrappers rather than adding new
  top-level `scripts/check-*.ts` files.
- Do not edit existing tests solely to reduce token output. Compact the
  commonly reused runner, package script, hook, or reporting layer instead.
- Keep GitHub Actions current on supported major versions and maintain the
  stable `PR CI / required` aggregate gate.
- New `main` or PR workflow runs should not cancel older validation runs.

## Dependency Freshness

- Track latest stable major and minor versions for JavaScript/Bun packages, Rust
  crates, GitHub Actions, Node, Bun, Tauri, Rust tooling, and validation CLIs.
- Patch and minor refreshes may be grouped when they are compatible and pass the
  full validation story.
- Every discovered major package/tooling bump must have a dedicated GitHub issue
  before implementation starts.
- Treat Cargo `0.x` semver-incompatible minor or patch jumps as major-style
  migration issues.
- Do not hide major migrations inside broad lockfile refresh PRs.

## Resource And Tooling Discipline

- Keep searches repo-scoped by default.
- Exclude `node_modules`, `dist`, `target`, `src-tauri/target`, plugin caches,
  and `~/.codex` unless explicitly needed.
- Prefer `rg -l`, `rg --count`, `jq` summaries, bounded `sed`/`head`/`tail`,
  and compact scripts.
- Do not dump full CI logs, full JSON, broad file lists, or unchanged green
  status.
- Resource cleanup concerns are primarily about RAM pressure, not disk space.
  Do not delete `node_modules`, build outputs, or target directories just for
  disk cleanup.
- Avoid leaving unnecessary local servers, browser sessions, or long-running
  build processes alive after they are no longer needed.
- Worktrees are allowed for parallel work when they reduce wait time without
  confusing branch ownership.
- Use `rg`/`rg --files` for repo search when available.
- Use `apply_patch` for manual file edits.
- Do not use AppleScript, `osascript`, System Events GUI scripting, JavaScript
  from Apple Events, or Apple Events automation unless the user explicitly
  permits that specific task.
