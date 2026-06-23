# RawEngine Agent Instructions

These instructions apply to the RapidRaw fork used for RawEngine work.

## Global Defaults

- Treat compact output, bounded failure detail, repo-scoped search, and
  syntax-aware code search as default behavior for this repo.
- Keep routine command, script, hook, poll, and validation output
  token-efficient by default. On success, prefer a compact summary over full
  logs, full JSON, long file lists, repeated green status, or unchanged state
  dumps.
- On failure, surface only bounded actionable detail: the failing step, a short
  error excerpt, and the next action or blocker. Do not dump full logs unless
  they are needed to make the next decision.
- For repeated noisy commands, prefer compact wrappers or summary modes so
  unchanged success output stays small.
- Do not repeat unchanged status summaries in thread updates. Only restate
  command or CI state when it changed, unblocked work, proved a fix, or exposed
  a blocker.
- Use `ast-grep` (`sg`) for syntax-aware code searches and structural rewrites.
  Prefer `rg` for plain text, filenames, and quick literal discovery; use
  `sg --lang <language> -p '<pattern>'` when the query depends on code
  structure.

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

- Max three active open PRs total.
- Before opening a PR, check the open PR queue with `gh` and keep every open
  PR moving toward merge, fix, close, or explicit deferral.
- Every open PR must have a disposition: merge, fix, close, or explicitly
  preserve as deferred.
- Do not leave PRs open for hours without checking status and taking the next
  action.
- Do not rebase or force-push a healthy PR that is only waiting on required
  checks unless it is behind/conflicting or branch protection requires it.
- Prefer vertical feature delivery over planning, schema-only, proof-only,
  probe-only, inventory-only, routing-only, or meta-tooling PRs.
- Feature PRs may exceed cleanup/CI/tooling PRs, but cleanup/CI/tooling PRs
  must not exceed feature PRs. Keep vertical feature delivery ahead of
  foundation polish.
- Avoid repo meta-tooling PRs unless they clearly improve product quality or
  prevent a recurring real failure.
- Product-facing implementation should be the default. Planning, schemas,
  probes, inventories, reports, and routing checks are supporting work, not a
  substitute for vertical product slices.
- Proof scripts should live inside the actual feature PR they validate. Do not
  open PRs whose main value is only a probe, schema, inventory, report, or
  routing check.
- Avoid committed generated inventory/report JSON unless it is a human-review
  artifact or required for a product validation gate.
- Do not maintain broad validation inventory files as routine PR churn. Prefer
  focused checks tied to changed product behavior.
- When something starts looking like slop, clean it up proactively instead of
  building more work on top of it.

## Startup Preflight

- Before implementation in a new turn or worktree, do one compact preflight
  using standard tools: confirm the repo root, branch/worktree state, dependency
  availability, GitHub repo resolution, remotes, and current open PR count.
- If preflight fails, fix that before feature work. Do not add or preserve repo
  scripts whose main purpose is managing agent workflow.
- Use `bun run worktree:create -- --branch codex/name` for every new Codex
  worktree. The helper fetches and fast-forwards `main`, creates the worktree
  from current `origin/main`, links verified Bun dependencies, configures Git
  and hooks, and verifies GitHub CLI repo resolution so implementation can start
  immediately. Do not hand-roll worktree setup unless this helper is blocked;
  fix the helper instead when it misses a recurring setup need. Use
  `bun run worktree:create -- --branch codex/name --dry-run` to validate setup
  without creating a worktree.

## GitHub Issues

- Every new GitHub issue should be refined enough for one small or medium PR
  where practical.
- Use milestones to group larger themes instead of making one issue represent
  several PRs.
- After feature PR batches, run backlog refinement: review the active goal and
  `RAW_EDITOR_PLAN.md`, consult at the milestone level, then create or update
  milestones and PR-sized issues from that consult-backed plan.
- Issue bodies should include `Why`, `How`, and `Validation` sections. Keep them
  concise, but include enough context, links, expected checks, screenshots,
  artifacts, runtime proof, or explicit plan-only status for the next agent to
  understand the goal without rediscovering intent.
- When issues come from consult-backed milestone refinement, include the
  relevant consult decision, constraints, validation expectations, and known
  follow-ups directly in the issue so implementation can start from the issue
  without reopening the same planning question.
- Existing GitHub issues should be periodically cleaned up: split broad issues
  into PR-sized work, close obsolete/meta-only issues, update stale issues with
  current context, and move related work into milestones instead of keeping
  oversized catch-all issues open.
- Audit the open backlog periodically for broad, stale, duplicate, or meta-only
  issues. Close or rewrite them so each remaining issue maps cleanly to one
  realistic PR.
- When refining existing issues, remove obsolete meta-only work, split broad
  catch-alls, and keep validation requirements tied to the product behavior the
  PR will actually prove.

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

- Use consult at the milestone level before creating or materially reshaping a
  milestone. Ask for the full milestone plan: product goal, architecture,
  sequencing, risks, validation strategy, and a PR-sized issue breakdown. Codex
  then creates or updates the GitHub milestone and issues from that plan.
- Consult should plan complete milestone work, not optimize for the smallest
  possible PR. Break consult's milestone plan into individual GitHub issues
  locally, with each issue sized for one realistic PR and grouped under the
  milestone.
- Do not consult separately for each PR by default. Issues should already carry
  current milestone-level consult context before implementation starts.
- A fresh consult is not required for an issue that already contains current,
  specific consult-backed milestone guidance for the exact slice being
  implemented. Reconsult only when milestone scope, risk, UI direction,
  science/math, architecture, or validation strategy materially changes.
- Ask consult for the full target plan, risks, architecture, and validation
  strategy for the topic or milestone. Do not ask consult to optimize for the
  smallest usable PR; break the returned plan into PR-sized slices locally.
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
- For fresh consult chats, start directly with the concrete milestone, feature,
  bug, PR, or decision context. Do not announce that the prompt is a fresh
  thread or add meta labels before the actual request.
- Treat consult output as advice. Verify it against current repo state before
  implementing.

## Subagent Usage

- Use subagents to parallelize independent, clearly scoped work when it will not
  confuse branch ownership or degrade review quality.
- For straightforward implementation tasks, clear CI/pipeline failures, issue
  refinement, backlog cleanup, log polling, or repeated status checks, prefer a
  smaller/faster subagent model such as 5.4 mini when available.
- Keep the main agent responsible for final design judgment, integration
  review, validation evidence, PR creation, and merge decisions.
- Delegate only work that has a clear expected output: patch, diagnosis, issue
  list, validation summary, or recommended next action.
- Do not let subagents open broad PRs, create meta-tooling churn, or mark
  feature work complete without runtime/product proof.
- Use worktrees for subagent implementation when changes are independent.
- While CI runs for one PR, use subagents for independent next slices, CI
  failure diagnosis, or PR queue monitoring instead of leaving the main agent
  idle.

## Validation And Quality

- Shift left as much as practical with checks that catch real product defects
  before manual review.
- Stop adding repo meta-tooling unless it clearly improves product quality or
  prevents a recurring real failure.
- Prefer vertical feature delivery over planning, schema-only, proof-only,
  inventory-only, report-only, routing-only, or meta-tooling work.
- Proof scripts should live inside the actual feature PR they validate. Do not
  open PRs whose main value is only a probe, schema, inventory, plan, report, or
  routing check. Include that work inside actual feature PRs when it is needed
  to ship the product behavior.
- Consult should return milestone-level plans and tradeoffs. The agent should
  split that plan into PR-sized GitHub issues instead of prompting consult for
  the smallest usable PR.
- Delete stale or low-value meta checks when they do not validate product
  behavior.
- If a helper script primarily exists to manage agent workflow rather than
  product quality, remove it or keep it out of the repo.
- Remove validation inventory JSON from routine gates. Do not add or preserve
  broad validation ledgers that are not directly required to prove changed
  product behavior.
- Use Bun for TypeScript/React package management, scripts, tests, and CI where
  applicable.
- Prefer Bun over inline Node commands when the task can be expressed as a repo
  script or Bun script.
- Keep TypeScript and linting strict. Do not introduce `as any` or
  `as unknown as`.
- Use Zod for TypeScript-facing runtime schemas and structured config validation.
- Before push or PR creation, use the repo precommit hook as the default local
  validation path: stage the intended files and try the commit. If precommit
  fails, fix the reported issue and retry the commit. Do not manually replay
  every check that precommit already covers unless debugging the failing hook.
- Run extra focused local validation only when it proves changed runtime,
  preview/export, UI, or image-output behavior that precommit cannot cover.
  Record those extra commands as PR evidence.
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
- For private RAW/image-editing features, validation must prove real runtime
  behavior on image output, not just schema acceptance.
- The user has explicitly allowed project validation to use their own RAW files
  under `/Users/cgas/Pictures/Capture One/Alaska`. Use that folder for private
  local RAW proof when it fits the feature, but do not commit those RAW files or
  generated private image artifacts.
- Keep private RAW validation standardized around one reusable private-root and
  report pattern.
- Private RAW reports may be generated locally as evidence, but should not be
  committed unless they are deliberate human-review artifacts.
- Do not count planning, schema, API, or UI-only work as a complete feature
  unless end-to-end workflow proof exists in the same PR. If E2E proof is not
  included, state the runtime status explicitly and keep or create a follow-up
  issue for E2E validation.
- Shift effort toward actual end-to-end feature slices with UI, runtime, and
  output proof.
- Keep frequently reused local checks and hooks token-efficient. On success,
  prefer compact summaries over full command/file lists; on failure, preserve
  actionable tool output.
- Keep checks compact: success output should be short, and failure output should
  show only actionable details.
- Put new integration, validation, runtime-proof, fixture-proof, and E2E-style
  checks in `tests/integration/checks/`. Keep `scripts/` for reusable helpers,
  generators, CI classifiers, and command wrappers rather than adding new
  top-level `scripts/check-*.ts` files.
- Avoid committed generated inventory/report JSON unless it is a human-review
  artifact or required for a product validation gate.
- Remove validation inventory JSON from routine gates. Do not maintain broad
  validation inventory files as routine PR churn; prefer focused checks tied to
  changed product behavior.
- Do not keep committed generated validation reports just to prove scripts are
  wired. Keep private RAW validation standardized around reusable private-root
  setup plus per-feature run reports that prove real output behavior.
- Prefer feature-specific runtime proofs that validate actual image output over
  broad status ledgers.
- Audit existing validation helpers when touching nearby code. Delete stale,
  duplicate, or low-value meta checks instead of carrying them forward.
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
- Use `ast-grep` (`sg`) for syntax-aware code searches and structural rewrites.
  Prefer `rg` for plain text, filenames, and quick literal discovery; use
  `sg --lang <language> -p '<pattern>'` when the query depends on code
  structure.
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
