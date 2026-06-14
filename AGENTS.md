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

## Pull Requests And GitHub Flow

- Use pull requests for all repo changes. Do not commit directly to `main`.
- Keep at most 2 active open PRs at a time. This is a hard cap.
- Use the two-PR cap as an A/B pattern when useful: one PR can build in CI while
  another independent PR is prepared or validated. Do not use the cap as
  permission to leave work sitting open.
- Do not leave PRs forgotten. Any PR open for more than 1 hour must be acted on:
  merge it if passing or clearly safe, refresh/rebase it if behind, fix it if
  failing, or close it if obsolete. If neither merge nor close is possible, add
  a clear status comment and keep checking until it resolves.
- Enable auto-merge on PRs when appropriate and keep branch state fresh enough
  for the required aggregate gate.
- PRs should stay small to medium sized where possible, ideally one issue and
  one validation story.
- PR bodies should include `How`, `Why`, and validation evidence.
- Update linked GitHub issues and milestones with evidence as work lands.

## Concise Output Discipline

- Optimize long-running work for low-token operation.
- Keep routine thread updates to one short sentence. Skip obvious narration and
  do not repeat the same PR queue, CI, or branch facts unless something changed.
- Summarize tool output only when it changes the next action, proves validation,
  or explains a blocker.
- Use concise conventional commit subjects. Add commit bodies only when the
  reasoning is not obvious from the diff or linked issue.
- Keep PR descriptions short: scope, validation commands, non-obvious risks or
  limits, and linked issue. Do not paste broad background, repeated plans, or
  large command output.
- Preserve hard evidence. Exact validation commands, runtime proof, blockers,
  safety decisions, and accepted or rejected consult advice must remain visible
  even when other prose is compressed.
- Prefer updating existing issues, docs, plan entries, and PR descriptions over
  adding new duplicated summaries.

## Recurring Reminder Automation

- The standing reminder automation is `check-rapidraw-consult`.
- Do not delete that automation unless the user explicitly asks to remove that
  exact reminder.
- It should run every 15 minutes and check for stale open PRs, especially PRs
  open for more than 1 hour, while enforcing the two-open-PR cap.
- It should also remind the agent to use the consult skill for hard decisions.
- If a temporary reminder is needed to check consult output, update the existing
  `check-rapidraw-consult` automation instead of creating or deleting a
  separate reminder, then restore it to the standing PR-stale/consult reminder
  afterward.

## Consult And Research

- Use the consult skill heavily for design decisions, color science, negative
  processing, film simulations, panorama stitching, HDR, focus stacking,
  super-resolution, app-server/agent architecture, GitHub Actions strategy, and
  tricky UI architecture.
- Use consult for science-heavy or math-heavy image processing decisions,
  especially deblur, denoise, sharpening, demosaic-adjacent behavior, gamut and
  color science, tone mapping, reconstruction, fusion, and validation metrics.
- Advanced image-quality features should improve iteratively with measured
  evidence. Do not treat the first working implementation as final when better
  math, fixtures, thresholds, UI controls, or runtime proofs are still available.
- Before an implementation PR changes advanced image-processing math, create or
  reference a consult-backed decision note, define the next measurable quality
  target, and state which follow-up iteration remains.
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
- Do not treat narrow checks as proof of broad behavior. Match validation scope
  to the requirement being claimed.
- For image-editing features, verify with real image processing behavior and
  artifacts, not only type/lint checks.
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
