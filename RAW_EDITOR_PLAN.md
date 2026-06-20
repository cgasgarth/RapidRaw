# RawEngine Product And Execution Plan

Status: implementation active, maintained plan artifact
Base application: RapidRAW public fork  
Primary platform: macOS first, with upstream cross-platform structure preserved where practical  
Target: a high-polish RAW editor that can credibly compete with Capture One and Lightroom while remaining open, scriptable, and agent-controllable

## Active Codex Goal

Current implementation goal: continuously implement RawEngine in the public `cgasgarth/RapidRaw` fork until June 15, 2026 at 5:00 PM Central Time, and continue afterward while this roadmap or open GitHub issues still have required work, using this plan as the source of truth for product scope, implementation order, validation requirements, and follow-up work.

Success for the current goal is continuous shipped progress through small or medium pull requests. Each completed work item should have a linked GitHub issue, a focused branch, a merged PR, validation evidence, and follow-up issues for intentional gaps. If one area blocks, document the blocker with evidence and immediately continue on other unblocked work from the roadmap.

The goal is not complete merely because the current backlog slice feels exhausted. If the next task is unclear, refine issues, create missing validation work, update this plan, or choose the next unblocked milestone item until the user stops the run or the time box is reached.

### Goal Operating Rules

- Work from the next ready unclosed GitHub issue in milestone order unless the user explicitly redirects.
- Keep `main` protected: no direct commits or pushes to `main`; all substantive work goes through PRs.
- Keep PRs small to medium and tied to one coherent validation story.
- Keep at most two active open PRs at a time. Use that cap as an A/B pattern
  when useful, where one PR can build while another independent PR is prepared
  or validated. Do not use it as permission to leave work open and stale.
- Use this plan as the source of truth for ordering, constraints, and completion evidence.
- Update this plan in the same PR when product direction, architecture, validation policy, or execution order changes.
- Record exact local commands, CI runs, screenshots, render artifacts, skipped checks, and residual risk in every PR.
- Keep capability status explicit: plan-only, schema-only, API-only, dry-run-only, UI-only, runtime apply-capable, and E2E-proven work are different states. A PR may make useful partial progress, but it must not close a full feature issue unless runtime behavior, preview/export behavior, E2E or equivalent workflow coverage, screenshots or artifacts, and remaining gaps are all proven or tracked.
- Any planning, API-only, or UI-only PR for a user-visible feature must link an E2E or equivalent workflow proof issue unless that proof ships in the same PR.
- Use the consult skill for major design decisions and high-risk color science, negative processing, panorama, HDR, focus stacking, super-resolution, agent, or UI architecture work.
- Use Computer Use for local macOS app verification before user-visible feature completion claims: run the app locally when practical, inspect the actual UI, verify the workflow is good-looking, intuitive, and functionally correct, and fix or track anything that does not work.
- Use Browser/Chrome and sample internet images only with source/license/provenance care. Use image generation when synthetic visual assets or controlled visual test material are appropriate.
- Do not mark the goal blocked unless the same blocker has repeated across the required blocked audit and no meaningful progress is possible without user input or external-state change.
- If the user changes direction, update the plan first, then continue from the revised source of truth.
- If the work resumes after compaction or interruption, re-read this goal section, the current milestone, and the newest user request before acting.

### Planning History

The original planning goal produced this document, the milestone fleet, issue seed index, validation map, governance policy, and first documentation PR. That planning-only phase is complete. This section now records the active implementation operating model.

### Implementation Execution Rule

Before starting a work item, identify the active issue, milestone, dependencies, branch name, expected PR size, and validation commands. Each autonomous implementation cycle should end with one merged PR, one evidence-backed blocked report, or one completed milestone summary, then continue to the next unblocked issue while the active goal remains in force.

### Final Goal Review Artifact

Before the active implementation goal can be considered finished, RawEngine must include a local HTML review page that the user can open in a browser to inspect the work completed during the goal.

Required artifact:

- A local HTML page committed or generated from committed source, with a stable documented path.
- It must summarize every new user-visible feature, UI change, validation surface, and major technical capability added during the goal.
- It must link each feature or validation area back to its GitHub issue, PR, milestone, relevant ADR or plan section, and validation evidence.
- It must include screenshots or render artifacts for user-visible features, UI flows, dialogs, panels, editor states, generated artifacts, and any visual image-processing behavior that was added or changed.
- It must include a test/validation section that lists local commands, GitHub Actions checks, fixture/golden-image checks, UI screenshots, render comparisons, skipped checks with reasons, and residual risks.
- It must include design decisions the user would want to know: command/API choices, color-management choices, validation-gate choices, AI/app-server boundaries, UI tradeoffs, data/provenance model choices, and any feature limitations.
- It must include a spec coverage section that maps completed work back to this plan's requirement IDs, milestones, and open follow-up issues.
- It must be usable offline for local review except for external links to GitHub, documentation, or source provenance pages.
- It must avoid marketing language and should read as an engineering review dashboard: concrete, evidence-backed, and easy to scan.

Screenshot requirements:

- Each user-visible feature should have at least one screenshot or rendered artifact unless the PR explicitly documents why that is not applicable.
- Screenshots should show the feature working, not only static UI shells.
- For image-processing features, include before/after or source/output artifacts when licensing and storage policy allow.
- For agent/app-server tools, include dry-run/apply/audit screenshots or captured HTML-rendered logs showing the tool path and safety boundary.
- Before the goal is complete, run the local macOS app and verify the review page and representative new UI surfaces through Computer Use. The final review evidence must state what was exercised, what looked or behaved incorrectly, and which PR or issue fixed or tracks each finding. Tracking issue: #1953.

This review page is part of the completion definition for the long-running implementation goal. If the page cannot be fully completed before the time box, the page must still exist and clearly list missing sections, missing screenshots, and follow-up issues.

### Consult-Backed Contract Freeze Gate

The 2026-06-10 RapidRaw project consult recommended adding a contract-freeze milestone before serious feature work in layers, color, computational photography, Negative Lab, app-server tools, or AI migration. This is now a planning rule:

- No UI-only edit paths: every meaningful edit, merge, layer, mask, Negative Lab, export, and agent operation must be represented as a typed command or read-only query.
- No direct app-server access to raw Tauri invokes: app-server tools call the same typed command layer as the UI and must support dry-run, approval boundaries, audit logging, cancellation, and replay.
- No implicit sRGB/display assumptions: color, preview, export, and proofing PRs must name the working space, display/output transform, and macOS color-management expectation they touch.
- No schema-changing PR without migration policy: edit graph, sidecar, catalog, command, tool, fixture, preset, artifact, layer, mask, and AI provenance schemas require versioning and migration tests.
- Warnings are validation outputs: image-quality warnings, fixture warnings, AI confidence warnings, color-management warnings, and legal/provenance warnings must be testable and stable enough to review.
- High-risk issues must name their blocking ADR and validation gate before implementation starts.
- Nondeterministic AI/provider operations require provenance: provider, model/version, prompt/tool input, seed when available, source asset hash, generated output hash, approval state, and fallback path.
- Derived computational outputs are first-class artifacts, not anonymous rendered files: HDR, panorama, focus-stack, super-resolution, generated positives, denoise/enhance outputs, and AI edits need provenance, invalidation, and editability policy.
- RapidRAW's current `jsAdjustments`-style broad payload seams should be wrapped behind a typed command envelope before agent, layer, mask, or large color work depends on them.
- Future masks and layers should move behind discriminated schemas instead of inheriting broad `any` or UI-only shape seams.

Contract-freeze work should produce ADRs, schema stubs, validation scripts, and GitHub issues before large feature PRs. It does not block narrow lint/type/CI hardening work, baseline audits, or plan/backlog refinement.

## Current Repo State

- Parent workspace: `/Users/cgas/Documents/RawEngine`
- Fork checkout: `/Users/cgas/Documents/RawEngine/RapidRaw`
- Public fork: `cgasgarth/RapidRaw`
- Upstream source: `CyberTimon/RapidRAW`
- Current state: implementation active through protected-branch pull requests.
- Current deliverables: issue-linked PRs, baseline evidence, validation hardening, and plan updates when scope changes.
- Repository topology: RawEngine remains the parent planning/orchestration workspace; the fork checkout lives under `RapidRaw/`. Inside `RapidRaw/`, `origin` points at the user's public RapidRAW fork and `upstream` points at `CyberTimon/RapidRAW`.
- Practical target: macOS first.
- Long-range target: preserve cross-platform architecture where it does not slow the macOS-first path.

## Maintained Planning Artifact

This document is not throwaway planning text. It is a maintained repository artifact.

Current repository rule:

- The first documentation PR added this mega PRD/technical plan markdown document to the public `RapidRaw` fork repository.
- This document is the authoritative plan for RawEngine work unless superseded by a newer issue, PR, or user instruction that is then folded back into the plan.
- Every milestone or issue that changes product direction, architecture, validation policy, or execution order must update this document in the same PR or link a follow-up issue.
- The document should be reviewed like code: diffs should be intentional, scoped, and tied to an issue.
- The document should gain a changelog section as implementation proceeds, recording major planning decisions and dates.

Completed bootstrap scope:

- `RAW_EDITOR_PLAN.md` exists in the public fork.
- Repository templates, governance notes, security policy, AGPL compliance note, baseline docs, labels, milestones, and issues are being added through PRs.
- Baseline and validation work is underway before major product feature work.

Repository bootstrap note:

- The public fork has an active protected `main` branch.
- Direct commits to `main` are disallowed by process and local hooks should reinforce that.
- Bootstrap exceptions should not be used for convenience commits.

Plan maintenance validation:

- Confirm the active goal section matches the current operating model.
- Confirm `RawEngine` parent workspace and `RapidRaw/` nested fork topology remain explicit.
- Confirm implementation sequencing still protects validation and baseline work before large product feature work.
- Confirm all consult outputs are incorporated or intentionally rejected.
- Confirm no stale "running consult" markers remain.
- Confirm headings are internally consistent.
- Confirm source links are present for major claims.
- Confirm issue/milestone index covers every major feature family.
- Confirm validation gates exist for every high-risk feature family.
- Confirm no accidental implementation files are included.

## Codex Autonomy Contract

Codex may proceed without asking the user when:

- The task preserves public AGPL compliance.
- The task improves lint, type, test, hook, or CI quality.
- The task adds tests, docs, issue templates, PR templates, validation scripts, or source verification.
- The task implements an already-approved requirement in this document.
- The task uses reversible migrations with clear rollback.
- The task is scoped to the next ready GitHub issue in milestone order.

Codex must stop or escalate when:

- A change could violate license obligations.
- A dependency has unclear license compatibility.
- A destructive data migration is proposed.
- A cloud service key, paid provider, or external account is required.
- A product claim would imply Capture One or Adobe equivalence without objective validation.
- A browser/plugin workflow fails and the only fallback would require OS-level automation. In that case, repair the intended plugin path or ask for explicit permission before using OS automation.
- The next issue is not ready and cannot be made ready by reading local code, public docs, or existing GitHub state.

## 1. Product Intent

RawEngine should become a professional, non-destructive RAW editor built from a RapidRAW fork, with image quality, workflow speed, and polish high enough to be taken seriously by working photographers.

The goal is not to copy proprietary products. The goal is to build an independent editor with comparable capabilities:

- Capture One-level color control and layer workflow.
- Lightroom-level library, masking, merge, enhance, and batch workflow.
- darktable/Ansel-level scene-referred color science and advanced technical control.
- RawTherapee-level detail, wavelet, film simulation, and local adjustment depth.
- RapidRAW-level modern base, GPU acceleration, Rust/TypeScript stack, and practical UX momentum.
- A first-class API and OpenAI app-server based expert editing agent so every meaningful edit operation can be invoked by software, not only by UI gestures.

RawEngine should be public from the start. The process should be designed so future implementation work can proceed autonomously through small or medium pull requests, each tied to a GitHub issue and milestone, with strict validation shifted as far left as possible.

## 2. Hard Requirements

### 2.0 Non-Goals For Early Passes

These are not product non-goals forever. They are constraints to keep early execution disciplined.

- No large product feature work before the maintained plan, baseline snapshot, and shift-left validation foundation are in place.
- No product feature work that bypasses issue tracking, pull requests, or validation evidence.
- No direct `main` commits for convenience work.
- No broad feature implementation while known baseline failures are undocumented or untracked.
- No Capture One or Adobe clone claims.
- No proprietary color-profile reverse engineering.
- No copied UI, icons, LUTs, ICCs, film looks, or assets from competitors.
- No agent UI automation as a substitute for typed edit tools.
- No destructive metadata writes until metadata policy and tests exist.
- No bundled internet sample images without license/source/hash metadata.
- No cloud or paid service dependency without explicit user approval.
- No weakening quality gates to make unrelated work pass.

### 2.1 Repository And Governance

- Use the public `cgasgarth/RapidRaw` fork as the RawEngine implementation repository.
- Keep the RapidRAW fork cloned under `/Users/cgas/Documents/RawEngine/RapidRaw` as the implementation checkout.
- Repository topology: the public GitHub repository is the user's `RapidRaw` fork of `CyberTimon/RapidRAW`. The local parent workspace is `/Users/cgas/Documents/RawEngine`, and the fork checkout lives under `/Users/cgas/Documents/RawEngine/RapidRaw`. Inside `RapidRaw/`, keep `origin` pointed at the user's RapidRAW fork and `upstream` pointed at `CyberTimon/RapidRAW`. Record the upstream RapidRAW commit SHA used for each baseline audit. Sync upstream only through pull requests, never by direct pushes to `main`.
- Treat RapidRAW's AGPL-3.0 license as a hard project constraint:
  - Keep RawEngine open source.
  - Preserve required license notices.
  - Preserve upstream copyright notices, `LICENSE`, `COPYING`, `NOTICE` files, and attribution where present.
  - Publish source for network-accessible app-server behavior when AGPL obligations apply.
  - Run dependency license checks in CI.
  - Treat hosted agent/cloud behavior as a license review item before deployment.
  - Do not import proprietary Capture One, Lightroom, or film-stock assets, algorithms, ICCs, LUTs, UI art, or branding.
- Protect `main`:
  - No direct pushes.
  - Require pull requests.
  - Require required status checks.
  - Require branches to be up to date before merge.
  - Require at least one approval once collaborators exist.
  - Require signed commits if practical.
  - Require conversation resolution before merge.
  - Disallow force pushes and deletions.
- Configure public repo safety settings:
  - Enable secret scanning.
  - Enable push protection for secrets where available.
  - Enable Dependabot alerts.
  - Enable Dependabot security updates if compatible with the workflow.
  - Enable CodeQL or equivalent static analysis.
  - Enable branch deletion after merge if desired.
  - Disable or restrict GitHub Actions write permissions by default.
  - Use least-privilege workflow permissions.
  - Pin third-party GitHub Actions by SHA for sensitive/release workflows where practical.
  - Require manual approval for first-time contributors if the repo is public.
- Keep dependency versions current (policy tracked by #935; audit automation tracked by #939):
  - Regularly audit JavaScript, Rust, GitHub Actions, Bun, Node, Tauri, and validation-tool dependencies against the latest stable major and latest stable minor releases, not only the latest compatible range.
  - Record current, latest compatible, latest stable minor, and latest stable major versions wherever ecosystem tooling can provide them.
  - Minor and patch dependency updates may be grouped when validation risk is low and the package family is coherent.
  - Each discovered major-version bump must get its own GitHub issue before implementation unless the packages are a tightly coupled toolchain that must be upgraded together.
  - Major-version issues must record migration notes, breaking-change links, validation commands, rollback strategy, and whether follow-up code changes are expected.
  - Dependency PRs must keep vulnerability, license, typecheck, lint, generated-artifact, and relevant Rust/Tauri checks green before merge.
- Add local commit protection:
  - A pre-commit hook must block commits while on `main`.
  - A pre-push hook must block pushes to `main`.
  - Hooks should also run fast local validation where practical.
  - Hook installation must be documented and preferably automated through a repo script.
- Use GitHub issues and milestones as the execution system:
  - Every planned body of work maps to a milestone.
  - Every implementation task maps to a GitHub issue.
  - Issues should normally map to one pull request.
  - PRs should be small to medium sized where possible.
  - Large work should be split by vertical capability, validation harness, UI surface, and follow-up polish.
- Maintain a GitHub project board if useful:
  - Backlog.
  - Ready.
  - In progress.
  - In review.
  - Blocked.
  - Done.
- Suggested project fields:
  - Milestone.
  - Area.
  - Priority.
  - Risk.
  - PR size.
  - Validation category.
  - Blocked by.
  - Target PR.
  - Evidence required.
  - Consult required.
  - Chrome/sample-image required.
  - Image generation required.
  - Plan update required.
- Pull requests must include:
  - What changed.
  - Why it matters.
  - Validation run locally.
  - Screenshots or image outputs for UI and image-processing changes.
  - Linked issue.
  - Known limitations or follow-ups.

### 2.1.1 Branch Protection Checklist

Current branch protection model:

- GitHub ruleset `Protect main` is active for `refs/heads/main`.
- Ruleset enforcement is active with no bypass actors.
- Pull requests are required before merge.
- Deletion and non-fast-forward updates are blocked.
- Review thread resolution is required.
- The stable required status check is `PR CI / required`.
- Auto-merge is allowed, but only after the required gate passes.
- Repository branch deletion after merge is enabled so merged PR branches do not accumulate.

Branch protection should continue to require:

- Pull request before merge.
- Required status checks.
- Stable required check names matching Section 10. Prefer one durable aggregate check over many volatile internal job names.
- Branch up to date before merge.
- Conversation resolution.
- Linear history if the project chooses squash/rebase-only.
- No force pushes.
- No branch deletion.
- No bypass for administrators unless emergency policy is documented.
- At least one review after collaborators exist.
- Dismiss stale approvals after new commits once collaborators exist.
- Restrict who can push to matching branches.

Required check rollout:

- Use `PR CI / required` as the branch-protection check for ordinary PRs.
- The aggregate gate must run with `if: always()` and fail if any blocking dependency fails, is cancelled, or is skipped unexpectedly.
- Internal job names may change as CI is optimized, but the aggregate required check name should remain stable.
- Add baseline checks under the aggregate gate after RapidRAW is cloned.
- Add strict checks under the aggregate gate after Milestone 1.
- Do not mark a check required until it exists and is stable.
- Once a check is required, do not weaken it without a tracked issue and explicit rationale.
- Do not use top-level `paths` filters on required workflows. Use always-starting workflows with job-level changed-file routing and an always-running aggregate gate.
- Path-aware CI routing must fail closed. Workflow, action, Rust, Tauri, dependency, build config, unknown, or unclassified paths must record a required macOS smoke decision. `PR CI / required` must not wait on the long macOS Rust/app smoke jobs; those run on `main` push and manual `workflow_dispatch`, while the PR keeps the routing decision as a completed peer job.
- Do not use workflow concurrency cancellation for PR or main validation unless project governance explicitly changes. Older runs should be allowed to complete.
- Merge queue was evaluated in `docs/ci/merge-queue-evaluation-2026-06-12.md` and should not be enabled yet. Revisit only after `main` validation latency is consistently lower and a merge-group routing path exists for changed-file classification.

Active PR queue discipline:

- Keep at most two active open PRs at a time unless the user explicitly changes
  the cap again. The normal pattern is one implementation PR plus, when useful,
  one independent docs/tooling PR that can progress while the first PR waits on
  CI.
- Do not let PRs sit open merely because more local work is available. Every open PR should be actively heading toward merge, or it should be closed with a comment that explains whether the work is superseded, preserved locally, or intentionally deferred.
- Prefer one active implementation PR at a time for work that touches shared config, validation gates, lockfiles, generated artifacts, or other files likely to conflict with the next similar PR.
- At most one unrelated infrastructure or documentation PR should be active beside a shared-config implementation PR unless the user explicitly approves a different cap for a specific reason.
- Do not stack multiple lint-rule PRs that all touch `eslint.config.js` while required macOS/Rust checks are queued. Keep follow-up lint work local, then open the next PR only after the earlier overlapping PR merges or is closed.
- After a PR merges, sync `main` before opening the next overlapping PR. Rebase and force-push an open PR only when it is genuinely behind, conflicting, failing, or required by branch protection; avoid needless head updates because they restart required checks.
- Auto-merge is a convenience, not a parking lot. If required checks are blocked for a long time, inspect the check state and either fix the blocker, keep only the minimal active queue, or close nonessential PRs and preserve the work locally.

### 2.1.2 Issue And PR Sizing Rules

Issue scope should be designed so Codex can complete it safely in one branch and one PR.

Good issue shapes:

- Add or tighten one validation gate.
- Convert one script family from npm to Bun.
- Add one schema and its tests.
- Add one UI panel with mocked or existing backend support.
- Add one API command family.
- Add one image-processing fixture set.
- Add one rendering regression test path.
- Refactor one bounded module behind an unchanged interface.

Avoid issue shapes:

- "Implement layers."
- "Make color like Capture One."
- "Add all CI."
- "Build the agent."
- "Rewrite the pipeline."

Split broad features into:

- Design issue.
- Schema issue.
- Backend/core issue.
- UI issue.
- API issue.
- Test fixture issue.
- Regression harness issue.
- Documentation issue.
- Follow-up polish issue.

Each issue should include a "PR budget":

- Small: one to three files or one narrow behavior.
- Medium: one bounded subsystem, tests included.
- Large: requires explicit split plan before work starts.

PR size target: one issue, one behavior change, and one validation story. Prefer under about 500 changed lines excluding lockfiles, generated schemas, and approved snapshots. Split any PR that changes both tooling and product behavior, changes more than one major subsystem, requires more than one design decision, or cannot be validated with one coherent command/artifact set.

Feature-completion rule:

- Planning, ADR, schema, API, UI shell, fixture, or dry-run work is useful
  progress, but it does not complete the user-visible feature by itself.
- A feature is complete only when the end-to-end workflow is implemented and
  validated: representative UI path, typed command/API path, runtime processing
  behavior, persistence/replay where applicable, and screenshot or image-output
  proof for user-visible behavior.
- If a PR ships only one slice, its PR body, plan entry, and linked issue must
  say the runtime status precisely, such as `planning-only`, `schema-only`,
  `API-only`, `UI-only`, `dry-run-only`, or `runtime apply-capable`, and must
  link follow-up E2E/workflow-proof issues.

### 2.1.3 Definition Of Ready

An issue is ready for implementation when it has:

- Milestone.
- Priority label.
- Area label.
- Type label.
- Clear goal.
- Explicit out-of-scope section.
- Expected validation commands.
- Expected screenshots/image artifacts if visual or image-processing work.
- Known dependencies.
- Acceptance criteria.

### 2.1.4 Definition Of Done

An issue is done when:

- The linked PR is merged.
- Required CI is green.
- Local validation is recorded in the PR.
- Tests or documented justification are included.
- Runtime, preview/export, E2E or equivalent workflow coverage is proven when
  the issue claims a complete user-facing or API-editing feature.
- Partial capability states are labeled honestly, such as plan-only,
  schema-only, API-only, dry-run-only, UI-only, or runtime apply-capable.
- UI or image-processing artifacts are attached when relevant.
- Documentation is updated when behavior or workflow changes.
- Follow-up issues exist for intentional gaps.
- No direct commit landed on `main`.

### 2.2 Engineering Standards

- Implementation is active and should continue through issue-linked pull requests.
- The no-change RapidRAW baseline snapshot is the first comparison point for implementation work.
- The first code-changing implementation steps after baseline documentation are linting, type strictness, local hooks, and CI hardening.
- TypeScript should use the strictest practical compiler settings.
- ESLint should use strict type-aware rules, React rules, hooks rules, import rules, accessibility rules, and zero-warning CI.
- Bun should be used for TypeScript/React package management, scripts, test execution, and CI where compatible.
- Rust should retain first-class validation:
  - `cargo fmt --check`
  - `cargo clippy --all-targets --all-features -- -D warnings`
  - `cargo test`
  - dependency/security checks
- All GitHub Actions jobs should run in parallel where dependency ordering is not required.
- Required PR status should flow through one stable aggregate gate, currently `PR CI / required`.
- Main and PR workflows should not cancel older queued/running checks; speed work should reduce duplicate work, improve caching, or route jobs by changed files instead of cancelling evidence.
- CI must fail on warnings for project-owned code.
- CI should include full build coverage, not only linting.
- Dependency-currency checks should be shifted left where practical:
  - Track latest stable major and minor versions for Bun/npm packages, Rust crates, GitHub Actions, Bun, Node, Tauri, Rust tooling, and validation CLIs.
  - Keep patch and minor updates current by default when they pass the full validation gate and do not require behavioral migration.
  - Prefer latest stable major and minor versions as the target state for first-party tooling and dependencies; older versions need a tracked blocker, compatibility note, or explicit deferral issue.
  - Add scripted stale-dependency reports for Bun/npm and Cargo dependency graphs, including current version, latest compatible version, latest stable minor version, latest stable major version, and release-note links when practical.
  - Add a scheduled or manually dispatched GitHub Action that reports outdated package versions without silently changing locks.
  - Convert every discovered major-version update into a tracked GitHub issue before implementation, using the format `deps(major): migrate <ecosystem>/<package> to <major>`.
  - Treat Cargo `0.x` semver-incompatible minor or patch jumps as major-style migration issues because they can carry breaking API changes under Cargo compatibility rules.
  - Each major-version issue should include migration notes, upstream breaking-change links, expected code/config changes, local validation commands, CI expectations, rollback notes, and whether the bump is blocked by another ecosystem update.
  - Work major-version issues individually or in clearly justified compatibility groups; do not bury major migrations inside broad lockfile refresh PRs.
  - Close the loop after each dependency PR by rerunning the audit and recording whether new major-version follow-up issues were created, already existed, or were intentionally deferred.
  - Prefer small PRs by package family, with one major bump per PR unless toolchain coupling requires otherwise.
- Validation should be local-first:
  - Hooks catch obvious mistakes before commit.
  - Local scripts mirror CI commands.
  - CI is the authoritative gate.
  - Nightly jobs cover expensive image-quality and performance checks.

### 2.3 Product Scope

RawEngine must support, or have planned implementation for:

- Non-destructive RAW editing.
- High-quality demosaic and camera-profile pipeline.
- Scene-referred editing pipeline.
- Display-referred output transforms.
- Full layer support.
- Full mask support.
- Capture One-style color editing.
- Lightroom-style library and batch workflow.
- Darktable/Ansel-style technical color controls.
- RawTherapee-style detail, wavelet, local adjustments, and film simulation depth.
- Advanced film simulations with high-quality color transforms.
- Full negative processing lab with its own dedicated UI and presets for major film stocks.
- Panorama stitching.
- HDR image stacking and merge.
- Focus stacking.
- Super-resolution via single-image enhancement and multi-image stitching/stacking.
- GPU acceleration for interactive editing.
- Sidecar-based non-destructive edits.
- Public editing API.
- OpenAI app-server based chat editing agent.
- Migration plan for RapidRAW's existing built-in AI tools to RawEngine typed APIs and Codex app-server tools where practical.
- Tool-callable editing operations.
- Test image corpus and image-quality validation.
- macOS polish as the first platform priority.

## 3. Source Baseline

This plan is based on public documentation and source references from:

- RapidRAW GitHub: <https://github.com/CyberTimon/RapidRAW>
- RapidRAW website: <https://www.getrapidraw.com/>
- RapidRAW license: <https://github.com/CyberTimon/RapidRAW/blob/main/LICENSE>
- darktable manual: <https://docs.darktable.org/usermanual/development/en/>
- Ansel: <https://ansel.photos/en/>
- RawTherapee RawPedia: <https://rawpedia.rawtherapee.com/Main_Page>
- Capture One support docs: <https://support.captureone.com/hc/en-us>
- Lightroom Classic help: <https://helpx.adobe.com/lightroom-classic/help.html>
- OpenAI Codex goals cookbook: <https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex>
- OpenAI Codex app server docs: <https://developers.openai.com/codex/app-server>
- OpenAI function calling docs: <https://developers.openai.com/api/docs/guides/function-calling>
- Bun docs: <https://bun.com/docs>
- TypeScript TSConfig reference: <https://www.typescriptlang.org/tsconfig/>
- typescript-eslint docs: <https://typescript-eslint.io/>
- GitHub Actions docs: <https://docs.github.com/actions>

## 4. Source Verification Log

Feature claims from competitors are planning inputs, not marketing claims. Before implementation depends on a claim, Codex should verify it from primary/current sources or the cloned source code.

| Area                  | Source To Verify                                                | Why It Matters                                 | Current Status                               |
| --------------------- | --------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| RapidRAW license      | `LICENSE`, README, repo metadata                                | AGPL/public-fork obligations                   | Public source checked, code audit pending    |
| RapidRAW build stack  | `package.json`, lockfiles, Tauri config, `src-tauri/Cargo.toml` | Bun migration, Rust toolchain, CI shape        | Public source checked, fork audit pending    |
| RapidRAW edit graph   | Sidecar format, adjustment structs, renderer order              | Non-destructive architecture                   | Pending clone/code audit                     |
| RapidRAW GPU path     | WGSL shader pipeline, wgpu setup                                | macOS performance and color precision          | Pending clone/code audit                     |
| RapidRAW masks/layers | UI state, mask data structures, renderer integration            | Layer and mask roadmap                         | Pending clone/code audit                     |
| RapidRAW HDR/panorama | Implementation, tests, memory behavior                          | Avoid duplicate work and regressions           | Public changelog checked, code audit pending |
| RapidRAW CI           | `.github/workflows`                                             | Quality-gate baseline                          | Public source checked, fork audit pending    |
| darktable             | Official manual                                                 | Scene-referred workflow, masks, color modules  | Public docs checked                          |
| Ansel                 | Official site/docs                                              | scene-referred and perceptual color references | Public docs checked                          |
| RawTherapee           | RawPedia                                                        | film simulation, local adjustments, wavelets   | Public docs checked                          |
| Capture One           | Official support docs                                           | layers, masks, color editor, HDR, panorama     | Public docs checked                          |
| Lightroom             | Adobe help docs                                                 | masking, enhance, panorama/HDR workflows       | Public docs checked                          |
| OpenAI app-server     | OpenAI developer docs                                           | agent integration and tool calls               | Public docs checked                          |
| Bun                   | Bun docs                                                        | CI/package manager migration                   | Public docs checked                          |
| TypeScript/ESLint     | Official TS and typescript-eslint docs                          | strictness/lint target                         | Public docs checked                          |

## 5. Competitive Feature Map

### 5.1 RapidRAW Baseline To Preserve And Extend

RapidRAW is the intended base because it already aligns with the desired stack and direction:

- Rust, TypeScript, React, Tauri, WGSL-oriented GPU work.
- Non-destructive `.rrdata` sidecar model.
- GPU-accelerated 32-bit editing pipeline.
- RAW support through `rawler`.
- Lens correction through Lensfun.
- Library and folder navigation.
- Filmstrip workflow.
- Virtual copies.
- Ratings, labels, tags, metadata, and recursive folder workflow.
- Batch operations.
- Tonal controls:
  - Exposure.
  - AgX.
  - Contrast.
  - Highlights.
  - Shadows.
  - Whites.
  - Blacks.
  - Curves.
- Color controls:
  - Temperature.
  - Tint.
  - Vibrance.
  - Saturation.
  - Color wheels.
  - HSL.
- Detail and effects:
  - Sharpening.
  - Clarity.
  - Structure.
  - Noise reduction.
  - LUT support.
  - Dehaze.
  - Vignette.
  - Glow.
  - Halation.
  - Flares.
  - Grain.
- Geometry:
  - Perspective.
  - Rotation.
  - Straightening.
  - Crop.
  - Warping.
- Masking:
  - Layer-based masking.
  - AI subject masks.
  - Depth masks.
  - Sky and foreground masks.
  - Color and luminance masks in recent releases.
- AI and generative editing hooks.
- Presets.
- Copy/paste adjustments.
- History.
- Panorama stitcher.
- HDR merge.
- Film negative workflow.
- Export controls.

RawEngine should keep these strengths, then harden the engineering foundation and broaden the professional feature set.

### 5.2 darktable Features To Learn From

darktable is important for technical depth and scene-referred design:

- Scene-referred workflow using linear-light processing before display transform.
- Filmic-style dynamic range mapping.
- Exposure as a central scene-referred control.
- Robust chromatic adaptation and color calibration.
- Parametric masks and drawn masks.
- Module stack with non-destructive ordering.
- Color balance RGB style grading:
  - Lift.
  - Gamma.
  - Gain.
  - Offset.
  - Power.
  - Slope.
  - Hue-preserving chroma/saturation control.
- Tone equalizer for dodge and burn with local contrast preservation.
- Diffuse/sharpen style physically inspired detail processing.
- Denoise profiled.
- Highlight reconstruction.
- Scopes:
  - Histogram.
  - Waveform.
  - Parade.
  - Vectorscope.
- Color assessment mode.
- Lens correction.
- Keyboard and controller-driven workflow.

RawEngine should adopt the useful concepts while keeping a more polished and less intimidating UI.

### 5.3 Ansel Features To Learn From

Ansel is important for a focused, modernized darktable-derived philosophy:

- Precision-oriented color science.
- Scene-referred workflow as the backbone for compositing and HDR.
- CIE CAT 2016 chromatic adaptation.
- JzAzBz and perceptual color spaces.
- darktable UCS-style color work.
- Color calibration and color matching.
- Hue qualifying and keying.
- Zone-system editing.
- HDR tone mapping.
- Lens deblur.
- Dehaze.
- Denoise.
- Highlight reconstruction.
- Automatic perspective correction.
- Leaner UI focused on edit quality instead of exposing every internal module at once.

RawEngine should use this as a signal: expose professional depth, but organize it into a cleaner product experience.

### 5.4 RawTherapee Features To Learn From

RawTherapee is important for RAW development depth:

- Multiple demosaic and RAW preprocessing options.
- Dark-frame and flat-field correction.
- Capture sharpening.
- Wavelet levels for detail by scale.
- Retinex.
- Local adjustments with RT-spots and U-Point-like behavior.
- Local Lab, CAM, wavelet, color, tone, denoise, and retinex controls.
- Film simulation through HaldCLUTs.
- Film negative conversion.
- Defringe.
- Haze removal.
- Color management depth.
- HSV and RGB curves.
- Color toning.
- Channel mixer.
- Black-and-white conversion.
- Metadata handling.

RawEngine should not expose every expert option at once, but should have an "Advanced" surface where these controls can exist without harming the main workflow.

### 5.5 Capture One Features To Match Conceptually

Capture One is the quality and professional workflow reference:

- Layer-centric local editing.
- Multiple mask types:
  - Brush.
  - Eraser.
  - Linear gradient.
  - Radial gradient.
  - Heal.
  - Clone.
  - AI subject.
  - AI background.
  - AI people.
  - AI select.
  - AI eraser.
  - Luma range.
  - Color range.
- Mask combinations:
  - Add.
  - Subtract.
  - Intersect.
  - Invert.
  - Feather.
  - Refine.
  - Rasterize/freeze when needed.
- Professional color editor:
  - Basic color ranges.
  - Advanced selective color ranges.
  - Skin tone uniformity.
  - Hue, saturation, lightness, and smoothness-style controls.
  - Color masks from selections.
  - ICC/profile creation or export path where legally and technically feasible.
- Base characteristics:
  - Camera profile.
  - Tone curve.
  - Film-like response controls.
  - Product-specific default looks.
- Tethered capture.
- Sessions and catalogs.
- Smart albums.
- Capture naming and ingest templates.
- High-quality tether workflow.
- HDR merge to linear DNG-like editable output.
- Panorama stitching to editable output.
- High-resolution panorama output.
- Pro-grade export recipes.
- Fast keyboard workflow and high-density UI polish.

RawEngine should aim for comparable workflow outcomes without copying proprietary implementation or UI.

### 5.6 Lightroom Features To Match Conceptually

Lightroom is the workflow, ecosystem, and AI-enhancement reference:

- Library/catalog workflow.
- Albums/collections.
- Presets and adaptive presets.
- Batch editing.
- Syncable edit model in the long term.
- Masking:
  - Subject.
  - Sky.
  - Background.
  - Objects.
  - People.
  - People parts.
  - Brush.
  - Linear gradient.
  - Radial gradient.
  - Color range.
  - Luminance range.
  - Depth range.
- Add/subtract/intersect mask composition.
- Denoise.
- Raw details.
- Super resolution.
- Panorama merge.
- HDR merge.
- HDR panorama merge.
- Boundary warp/fill edges/auto crop-style controls.
- Non-destructive merge output.

RawEngine should learn from Lightroom's speed and simplicity while keeping stronger local control and API openness.

## 6. Product Principles

- Original RAWs are immutable.
- Every edit is non-destructive and serializable.
- Every UI operation has an equivalent API command.
- Every API command is schema-validated.
- Every edit can be undone, redone, copied, pasted, versioned, and replayed.
- The editing pipeline should be deterministic for the same inputs, versions, and settings.
- Scene-referred editing should be the default internal model.
- Display/output transforms should be explicit and testable.
- GPU acceleration should make interaction fast, but CPU/headless paths should exist for validation and batch rendering.
- Professional features should be discoverable without making the default UI feel like a lab instrument.
- macOS should feel native and polished even if the foundation remains cross-platform.
- Automation and the agent are first-class product surfaces, not afterthoughts.

## 6.1 Requirement Matrix Seed

Every major capability should eventually become one or more GitHub issues. This matrix provides stable requirement IDs for tracking.

| ID             | Domain           | Requirement                                     | Source Inspiration                               | Priority | API Required | Acceptance Criteria                                                                                                                   | Validation                                        |
| -------------- | ---------------- | ----------------------------------------------- | ------------------------------------------------ | -------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| REQ-BASE-001   | Base             | Non-destructive RAW editing                     | RapidRAW, Lightroom, Capture One                 | P0       | Yes          | Original files never modified; edits replay from sidecar/graph                                                                        | original hash, sidecar roundtrip                  |
| REQ-BASE-002   | Base             | GPU-accelerated interactive pipeline            | RapidRAW, darktable                              | P0       | Indirect     | previews update interactively on macOS                                                                                                | render latency, GPU/CPU parity                    |
| REQ-BASE-003   | Base             | RAW decode and camera profile foundation        | RapidRAW, RawTherapee, Capture One               | P0       | Yes          | supported RAWs open with correct metadata/profile path                                                                                | fixture open tests, color chart                   |
| REQ-COLOR-001  | Color            | Scene-referred color pipeline                   | darktable, Ansel                                 | P0       | Yes          | edits occur in defined scene-referred space with explicit display transform                                                           | ColorChecker, clipping, gamut tests               |
| REQ-COLOR-002  | Color            | Capture One-class selective color editor        | Capture One                                      | P0       | Yes          | smooth range selection and HSL-style adjustment with masks                                                                            | color fixtures, render artifacts                  |
| REQ-COLOR-003  | Color            | Skin tone uniformity                            | Capture One                                      | P1       | Yes          | hue/saturation/lightness uniformity controls work locally and globally                                                                | skin tone fixtures                                |
| REQ-COLOR-004  | Color            | Advanced color grading controls                 | darktable, Ansel, Capture One                    | P1       | Yes          | color balance/wheels/channel controls serialize and replay                                                                            | schema and render tests                           |
| REQ-LAYER-001  | Layers           | Full adjustment layer support                   | Capture One, RapidRAW                            | P0       | Yes          | add/reorder/rename/duplicate/delete/toggle/opacity                                                                                    | graph, undo, render tests                         |
| REQ-MASK-001   | Masks            | Brush, gradient, range, and AI masks            | Lightroom, Capture One, RapidRAW                 | P0       | Yes          | masks combine, serialize, replay, and render correctly                                                                                | mask artifacts, IoU where possible                |
| REQ-MASK-002   | Masks            | Add/subtract/intersect mask composition         | Lightroom, Capture One                           | P0       | Yes          | compositing works across mask types                                                                                                   | mask composition fixtures                         |
| REQ-FILM-001   | Film             | High-quality film simulation engine             | RawTherapee, film workflows                      | P1       | Yes          | LUT plus grain/halation/curve/look controls                                                                                           | before/after fixtures, legal provenance           |
| REQ-FILM-002   | Film             | Film negative conversion                        | RapidRAW, RawTherapee                            | P1       | Yes          | film base sampling and inversion workflow                                                                                             | negative scan fixtures                            |
| REQ-NEG-001    | Negative Lab     | Dedicated negative processing lab UI            | User requirement, film scan workflows            | P1       | Yes          | purpose-built workflow for converting, profiling, correcting, and batch processing scanned negatives                                  | negative scan fixtures, UI artifacts              |
| REQ-NEG-002    | Negative Lab     | Presets for major film stocks                   | User requirement, film workflows                 | P1       | Yes          | legally safe presets for major color and black-and-white film stocks, with provenance and trademark-safe naming policy                | preset review, before/after fixtures              |
| REQ-NEG-003    | Negative Lab     | Roll/session model                              | Film scan workflows, batch consistency           | P1       | Yes          | scans can be grouped into roll sessions with shared base samples, anchor frames, per-frame overrides, and positive variant provenance | roll consistency fixtures, sidecar roundtrip      |
| REQ-NEG-004    | Negative Lab     | Density-domain inversion pipeline               | Film scanning tools, color science               | P1       | Yes          | negative conversion operates in a defined density/transmittance model with explicit input profile and process assumptions             | CPU/GPU parity, color fixtures                    |
| REQ-NEG-005    | Negative Lab     | API-callable negative lab commands              | User requirement, app-server agent               | P1       | Yes          | every negative lab operation is command/API-callable, serializable, undoable, batchable, and safe for agent tooling                   | command replay, dry-run, provenance tests         |
| REQ-NEG-006    | Negative Lab     | Major film stock preset registry                | User requirement, film scan workflows            | P1       | Yes          | maintained registry covers major current and archival stock families with legal status, provenance, fixture status, and preset tier   | registry lint, provenance review, coverage matrix |
| REQ-NEG-007    | Negative Lab     | Negative lab QC proofing                        | Film scan workflows, professional batch delivery | P1       | Yes          | lab can generate reviewable contact sheets, warnings, density summaries, and preset comparison artifacts for a roll/session           | artifact snapshots, UI tests, batch reports       |
| REQ-NEG-008    | Negative Lab     | Acquisition health checks                       | Consult-backed film scan workflow                | P1       | Yes          | scan setup quality and upstream correction risks are visible before conversion                                                        | warning fixtures, UI artifacts, metadata checks   |
| REQ-NEG-009    | Negative Lab     | Objective versus creative operation contract    | Consult-backed color science                     | P1       | Yes          | acquisition, inversion, roll normalization, and creative rendering commands are stage-labeled and separately testable                 | schema lint, command replay, render artifacts     |
| REQ-NEG-010    | Negative Lab     | Measured stock-profile methodology              | Consult-backed preset governance                 | P1       | Yes          | named-stock profiles require project-owned measurement data, fixture IDs, reproducible methodology, and approved claims language      | preset registry lint, fixture manifests           |
| REQ-NEG-011    | Negative Lab     | Negative lab fixture and numeric gates          | Consult-backed validation strategy               | P1       | Indirect     | negative conversion changes are guarded by fixture manifests, color/numeric gates, golden artifacts, and warning stability checks     | DeltaE, gray ramp, CPU/GPU, golden approvals      |
| REQ-NEG-012    | Negative Lab     | Lab workflow regression suite                   | User requirement, professional lab workflow      | P1       | Yes          | full lab workflows are UI-tested from import through QC, positive variant creation, agent dry-run, and export                         | Playwright/UI artifacts, app-server replay        |
| REQ-HDR-001    | HDR              | HDR merge from brackets                         | Capture One, Lightroom, RapidRAW                 | P1       | Yes          | bracketed files merge into editable artifact                                                                                          | HDR fixtures, deghost/alignment                   |
| REQ-PANO-001   | Panorama         | Panorama stitching                              | Capture One, Lightroom, RapidRAW                 | P1       | Yes          | projections and boundary controls produce editable artifact                                                                           | pano fixtures, memory budget                      |
| REQ-FOCUS-001  | Focus            | Focus stacking                                  | professional macro workflow                      | P2       | Yes          | focus brackets align and blend to editable artifact                                                                                   | sharpness map, focus fixtures                     |
| REQ-SR-001     | Super-resolution | Multi-image super-resolution/stitching          | Lightroom, computational photo                   | P2       | Yes          | conservative high-res output avoids hallucinated detail                                                                               | chart fixtures, crop comparisons                  |
| REQ-LIB-001    | Library          | Professional culling/library workflow           | Lightroom, Capture One, darktable                | P1       | Yes          | ratings, labels, filters, compare/survey, virtual copies                                                                              | library tests, UI artifacts                       |
| REQ-EXPORT-001 | Export           | Export recipes and batch queue                  | Lightroom, Capture One                           | P1       | Yes          | repeatable recipes with color/size/metadata controls                                                                                  | export tests, metadata checks                     |
| REQ-API-001    | API              | All editing surfaces callable through typed API | User requirement, OpenAI app-server              | P0       | Yes          | UI and agent use same command layer                                                                                                   | schema drift, command replay                      |
| REQ-AGENT-001  | Agent            | Expert chat agent through app-server tools      | OpenAI app-server                                | P1       | Yes          | agent inspects, edits, previews, and logs through tools                                                                               | replay, approval, injection tests                 |
| REQ-MAC-001    | macOS            | Polished macOS-first app                        | User requirement                                 | P0       | N/A          | app feels native enough for daily use                                                                                                 | macOS build, UI QA, performance                   |

Requirement rules:

- `API Required` defaults to `Yes` for all editing, metadata, library, render, export, and agent-visible operations.
- Any `API Required: No` entry needs written justification.
- A requirement is not complete until it has at least one linked issue, validation method, and acceptance criteria.
- Marketing claims must not use competitor names as quality claims until objective validation exists.

## 7. Target Product Surfaces

### 7.1 Library

Required capabilities:

- Folder browser.
- Recursive folder import.
- Session-style project mode.
- Catalog-style database mode, later phase.
- Filmstrip.
- Grid.
- Compare view.
- Survey view.
- Loupe view.
- Before/after view.
- Reference image view.
- Metadata panel.
- EXIF/IPTC/XMP view and edit where safe.
- Ratings.
- Color labels.
- Pick/reject flags.
- Tags.
- Smart filters.
- Search.
- Saved searches.
- Virtual copies.
- Stacks.
- Version history.
- Batch rename.
- Batch move/copy.
- Missing file relink.
- Duplicate detection.
- External editor round-trip, later phase.

### 7.2 Develop

Core editing groups:

- Base:
  - Camera profile.
  - Tone curve.
  - White balance.
  - Exposure.
  - Contrast.
  - Highlight recovery.
  - Shadow recovery.
  - Whites.
  - Blacks.
  - Black point.
  - Midtone placement.
  - Dynamic range compression.
- Color:
  - White balance picker.
  - Tint.
  - Vibrance.
  - Saturation.
  - HSL.
  - HSV.
  - Color wheels.
  - Split toning.
  - Channel mixer.
  - Color balance RGB-style grading.
  - Selective color ranges.
  - Skin tone uniformity.
  - Color calibration.
  - Camera matching profiles.
  - Custom profile authoring/export path.
- Tone and curves:
  - RGB curve.
  - Luma curve.
  - Per-channel curves.
  - Parametric curve.
  - Filmic/scene-to-display transform.
  - Zone/tone equalizer.
- Detail:
  - Capture sharpening.
  - Creative sharpening.
  - Deconvolution/lens deblur.
  - Texture.
  - Clarity.
  - Structure.
  - Local contrast.
  - Noise reduction.
  - AI denoise, later phase.
  - Defringe.
  - Chromatic aberration correction.
- Geometry:
  - Crop.
  - Rotate.
  - Straighten.
  - Perspective correction.
  - Automatic perspective correction.
  - Lens profile correction.
  - Manual distortion.
  - Vignetting correction.
- Effects:
  - Film grain.
  - Halation.
  - Bloom/glow.
  - Vignette.
  - Dehaze.
  - LUT.
  - Film simulation.
- Retouch:
  - Heal.
  - Clone.
  - Content-aware remove, later phase.
  - Dust spot visualization.

### 7.3 Layers And Masks

Workflow contract: `docs/layers/layer-workflow-model-2026-06-14.md`.

Layer model requirements:

- Multiple edit layers.
- Adjustment layers.
- Pixel/retouch layers where necessary.
- Merge output layers for HDR/panorama/focus/super-resolution.
- Layer opacity.
- Layer visibility.
- Layer enable/disable.
- Layer naming.
- Layer reorder.
- Layer duplication.
- Layer copy/paste.
- Layer presets.
- Layer blend modes where technically meaningful:
  - Normal.
  - Multiply.
  - Screen.
  - Overlay.
  - Soft light.
  - Color.
  - Luminosity.
  - Hue.
  - Saturation.
- Per-layer masks.
- Per-layer adjustment stack.
- Layer-scoped history.

Mask model requirements:

- Brush mask.
- Eraser.
- Linear gradient.
- Radial gradient.
- Luminance range.
- Color range.
- Depth range when source data or model output exists.
- Subject mask.
- Sky mask.
- Background mask.
- Foreground mask.
- People mask.
- Face/skin/eyes/lips/hair/clothes parts, later phase.
- Object select.
- AI eraser/refine.
- Mask add/subtract/intersect.
- Invert.
- Feather.
- Density.
- Flow.
- Opacity.
- Edge refine.
- Mask blur.
- Mask contrast.
- Mask visualization overlays.
- Rasterize/freeze dynamic masks.
- Recompute dynamic masks after crop/transform.
- Copy masks between images.
- Paste masks with remapping when geometry differs.

### 7.4 Computational Photography

#### Panorama Stitching

Requirements:

- Stitch multiple RAW or rendered linear inputs.
- Output an editable non-destructive merge artifact.
- Auto align.
- Manual control point correction, later phase.
- Projection modes:
  - Spherical.
  - Cylindrical.
  - Perspective.
  - Panini.
- Boundary handling:
  - Auto crop.
  - Fill edges, later phase.
  - Warp/boundary adjustment.
- Multi-row panorama support.
- Gigapixel-aware tiling strategy.
- Exposure and white-balance normalization.
- Lens correction before stitch where appropriate.
- Ghost handling, later phase.
- Super-resolution from stitched overlap where possible.
- Validation with known panorama test sets.

#### HDR Merge

Requirements:

- Merge bracketed RAW files.
- Auto align.
- Deghost.
- Exposure bracket detection.
- Output editable scene-referred high-dynamic-range merge artifact.
- Preserve metadata.
- Preserve camera/lens profile data when possible.
- Produce a merged source that behaves like a RAW-like image in the editor.
- Validate against bracket test sets with motion, highlights, and low-light scenes.

#### Focus Stacking

Requirements:

- Align focus-bracketed images.
- Estimate sharpness maps.
- Blend all-in-focus output.
- Retain editable source stack metadata.
- Support retouching stack artifacts.
- Validate with macro and product photography test sets.

#### Super-Resolution

Requirements:

- Single-image super-resolution, later phase if model-based.
- Multi-image super-resolution from burst or shifted images.
- Panorama-style super-resolution through overlap and stitching.
- Preserve natural texture.
- Avoid hallucinated detail in professional modes unless explicitly requested.
- Provide conservative, standard, and aggressive modes.
- Validate with resolution charts and real photographs.

#### Derived Artifact Model

HDR, panorama, focus stack, and super-resolution outputs should not be treated as ordinary exports. They are derived assets that can become editable sources in the normal pipeline.

Derived artifact requirements:

- Artifact type:
  - HDR merge.
  - Panorama.
  - Focus stack.
  - Super-resolution.
  - HDR panorama, later phase.
- Source asset list with stable IDs.
- Source file hashes.
- Source edit graph revisions used as inputs.
- Operation settings.
- Algorithm version.
- Model version if AI/model-based.
- Alignment/control data where applicable.
- Intermediate cache references where applicable.
- Output dimensions and color space.
- Editable output reference.
- Missing-input behavior.
- Invalidation behavior when source edits change.
- Regenerate command.
- Export command.
- Provenance visible in UI and API.

Derived artifact issues:

- `api(artifact): define DerivedAsset and ArtifactNode schema`
- `api(artifact): define missing-input and invalidation behavior`
- `api(artifact): add regenerate command contract`
- `validation(artifact): add provenance roundtrip tests`
- `ui(artifact): show source provenance for derived outputs`

### 7.5 Film Simulation

Film simulation must be treated as a serious color product, not a simple LUT picker.

Requirements:

- HaldCLUT and LUT import.
- Built-in open, legally safe simulation looks.
- Camera/profile-aware transforms.
- Scene-referred friendly looks where possible.
- Output-referred creative looks where appropriate.
- Film grain model:
  - Size.
  - Roughness.
  - Chroma/luma separation.
  - Highlight/shadow behavior.
  - ISO-like presets.
- Halation model:
  - Threshold.
  - Radius.
  - Color.
  - Intensity.
  - Channel behavior.
- Bloom/glow model.
- Color response controls.
- Contrast curve controls.
- Print film style output transforms.
- Black-and-white film simulations.
- Negative conversion:
  - Film base sampling.
  - Orange mask removal.
  - Per-channel curve correction.
  - Inversion workflow.
- Side-by-side simulation comparison.
- Film look browser with favorites.
- Simulation strength and mix controls.
- Ability to create, save, version, and share looks.

### 7.5.1 Negative Processing Lab

RawEngine should include a full negative processing lab as a first-class product surface, not just a checkbox inside film simulation. It should feel like a dedicated professional scanning and conversion room inside the app: import scans, split frames, calibrate the film base, convert negatives, normalize rolls, compare stock presets, inspect QC warnings, generate positives, and continue non-destructive editing from the same project.

Product bar:

- Own top-level Negative Lab workspace or mode, with its own navigation, layouts, state, shortcuts, command API namespace, validation fixtures, and documentation.
- Handles one-off negative conversions, full roll/contact-sheet workflows, archival lab scans, camera-scanned RAW workflows, flatbed scan workflows, and agent-driven batch work.
- Treats acquisition metadata as durable session state, not just an import-time warning, because negative quality depends on the camera/scanner/light-source chain.
- Treats presets for major film stocks as a governed product catalog with provenance, legality, versioning, fixture coverage, and refresh cadence.
- Produces editable positive variants that remain linked to original negative scans and roll/session settings.
- Makes every lab operation available through the same typed command surface used by UI, automation, and the OpenAI app-server agent.
- Does not ship broad "exact stock emulation" claims unless the profile is measured by the project, reproducible, fixture-backed, and cleared by the legal/provenance policy.

Non-negotiable product interpretation:

- Negative Lab is a peer workspace to Library, Editor, Export, and future Merge workspaces. It must not be implemented as a small film-simulation panel, a single "invert negative" checkbox, or a hidden advanced control group.
- The lab owns a complete workflow: acquisition check, roll setup, frame split, base calibration, density-domain conversion, roll normalization, preset/profile comparison, QC proofing, positive variant creation, and handoff to the normal editor.
- Every workflow step must have a UI affordance, typed command, undo/replay behavior, validation artifact, and app-server tool story before the feature is considered complete.
- The user-facing language should frame stock-aware profiles as conversion starting points and measured project profiles, not as unofficial copies of manufacturer or commercial preset products.
- Lab UI should be dense, professional, and inspection-oriented: the viewer, scopes, warnings, sample readouts, frame queue, and provenance panels should help users diagnose scans, not just choose looks.
- Batch and agent workflows should be designed from the start, with dry-run, selected-frame scope, cancellation, warning severity, and no-overwrite output defaults.

Mandatory consult and design gate:

- When this area reaches active design/implementation, use the consult skill heavily before architecture, UI, color-science, preset-taxonomy, validation, and app-server agent decisions.
- The first implementation issue for this area must be `consult(negative-lab): get negative processing lab design review`, and no architecture/UI/pipeline PR should begin until the consult output is summarized in this document or a linked ADR.
- Consult should cover film scanning workflows, color negative inversion, black-and-white negative workflows, ECN-2/cinema workflows, slide/reversal helper workflows, film stock preset strategy, UI flow, color science, legal/trademark risk, fixture acquisition, and validation thresholds.
- For each high-risk phase, open a follow-up consult before implementation if the existing ADR does not answer the design question: density model, stock preset registry, color-management integration, GPU parity, roll normalization, agent bulk operations, and QC metrics.
- Do not implement a large negative lab feature without a consult-backed design pass, linked ADR or design issue, acceptance criteria, and planned validation fixtures.

Dedicated UI requirements:

- Negative Lab workspace/tab.
- Left rail roll/frame queue optimized for scans.
- Center viewer with positive/negative split, before/after split, density view, channel view, clipping overlays, crop/border overlays, and sample-point overlays.
- Right control stack grouped by Input, Frame Detection, Base, Inversion, Color, Roll Sync, Preset, QC, and Output.
- Bottom filmstrip with applied-state badges, warning badges, crop status, base-sample status, and roll-sync status.
- One-image guided conversion mode for new users.
- Batch conversion mode for full rolls.
- Advanced mode that exposes the full density/inversion model.
- Preset browser with generic built-ins, verified project profiles, user profiles, and reference mappings.
- Side-by-side preset comparison for the current frame and anchor frames.
- Save, version, duplicate, and share custom negative profiles.
- Export converted positives as normal editable RawEngine variants.

Dedicated UI modes:

- Intake: choose scan source type, roll/session, process family, capture/scanner profile, light source, frame format, and expected preset family.
- Frame Split: detect, correct, and approve frame crops from strips, sheets, and single-frame scans.
- Base Calibrate: inspect candidate base samples, add manual samples, reject contaminated samples, and view confidence metrics.
- Convert: tune density-domain inversion, per-channel curves, RGB balance, output contrast, black/white point, and neutral/skin sample targets.
- Roll Match: select anchors, synchronize exposure/density/color across frames, view outliers, and apply safe roll-level operations.
- Preset Studio: browse major-stock presets, compare generic/profile/user/reference tiers, inspect provenance, save custom profiles, and test profile variants against anchor frames.
- QC Proof: generate contact sheets, warning reports, density summaries, crop warnings, clipping reports, before/after grids, and preset comparison artifacts.
- Output: create positive variants, send to the normal editor, batch export, or hand commands to the app-server agent with dry-run and rollback support.

Required UI affordances:

- Density histogram and RGB channel histograms before and after inversion.
- Sample-point readouts for negative RGB, estimated density, inverted RGB, Lab/LCH where available, clipping state, and assigned role such as base, neutral, skin, highlight, or shadow.
- Per-frame warning badges for missing base sample, low-confidence base sample, contaminated sample, crop ambiguity, blown channel, dense negative, thin negative, mixed light, unknown scan correction, and missing profile.
- Roll health summary showing anchor frames, outliers, per-frame overrides, shared settings, fixture/profile status, and batch readiness.
- Preset provenance inspector that shows tier, process family, naming/legal status, fixture IDs, source notes, intended scan assumptions, algorithm version, and confidence.
- Non-destructive "compare recipes" view that can show multiple preset/profile candidates without committing them to the edit graph.

Dedicated workspace UX requirements:

- Persistent roll cockpit visible across lab stages, showing roll status, frame count, process family, acquisition profile, current base strategy, current roll anchor, current stock/profile, warnings by severity, unsynced frame overrides, batch operation status, and export readiness.
- Frame health grid/table with frame number, thumbnail, detected process/profile, base confidence, exposure density, clipping status, color-balance confidence, focus/sharpness estimate, dust/scratch score, roll-match status, override status, QC status, and export status.
- Frame health interactions for sorting by warning severity, filtering low-confidence frames, selecting anchor candidates, grouping frames into scenes, excluding frames from export, and applying roll operations only to selected groups.
- Expert densitometer inspector with hover readouts for linear RGB, transmittance, density, post-inversion RGB, Lab/XYZ where available, clipping flags, sampled-patch mean/median/standard deviation/min/max, per-channel density histograms, base/fog statistics, neutral-candidate statistics, and curve-contribution views.
- Base Sampling Studio with automatic base candidate overlays, manual point samples, rectangular samples, polygon/brush samples, rejected contaminated samples, multiple samples per frame, roll-shared samples, frame-only samples, confidence scoring, sample history, and contamination warnings for rebate text, dust, sprocket holes, lab borders, or scanner bed artifacts.
- Roll Matching Console with anchor frame lane, suggested anchor candidates, scene grouping, exposure normalization, neutral balance normalization, contrast normalization, saturation/rendering normalization, objective-only sync, opt-in creative sync, per-frame override diffs, frame-deviation heatmaps, and one-click revert to roll baseline.
- Profile comparison matrix where rows can be frames or anchor frames, columns can be candidate profiles/presets, and cells show rendered thumbnails plus confidence, warnings, and touched-parameter badges.
- Negative/positive synchronized viewer modes: original negative, base-corrected negative, density view, objective positive conversion, creative positive render, vertical split, horizontal split, wipe, difference view, channel solo, gamut warning, clipping warning, base-sample overlay, frame-boundary overlay, dust/scratch overlay, and roll-match deviation overlay.
- QC Proof checklist statuses: `needs_review`, `approved`, `approved_with_warnings`, `rejected`, and `excluded_from_export`.
- QC Proof checklist items: base sample verified, no severe clipping, neutral balance acceptable, skin/gray/known neutral checked where available, frame boundary checked, roll consistency checked, output profile selected, filename/export policy checked, and provenance complete.
- Agent Activity panel showing commands applied, command source (`user`, `ui`, `agent`, `server`, or `batch`), dry-run versus committed state, parameter diff, affected frames, warnings raised, previews generated, undo point, and provenance entry.
- WGPU/React overlay acceptance criteria: base-sample overlays stay pixel-aligned at all zoom levels, frame-boundary handles align with rendered image coordinates, wipe/split comparison does not drift, density readouts sample exact rendered coordinates, Retina scale factor is handled, P3/sRGB proof modes do not shift overlays, and contact-sheet rectangles remain stable through pan/zoom/rotate.

Supported negative lab input modes:

- Camera-scanned RAW or DNG negative captures.
- Camera-scanned TIFF/PNG/JPEG derived from RAW.
- Flatbed-scanned TIFF with optional scanner ICC/input profile.
- Lab-scanned TIFF/JPEG with explicit limitation notes when scanner profile and raw capture data are unavailable.
- Multi-frame/contact-sheet scans that need frame splitting.
- Single-frame scans with visible rebate/borders.
- Cropped scans without borders where base detection must rely on manual or roll-level base samples.
- Color negative, black-and-white silver negative, chromogenic black-and-white negative, ECN-2/cinema color negative, redscale/creative color negative, and E-6 slide/reversal helper modes.

Acquisition quality and scan setup requirements:

- Negative Lab must make scan acquisition quality observable before conversion so users can separate scan problems from inversion problems.
- Record capture method: camera scan, flatbed, lab scanner, minilab JPEG/TIFF, contact sheet, or unknown.
- Record scanner/camera/lens profile, light source, approximate CCT where known, diffuser, copy-stand notes, film holder, border visibility, frame spacing, skew, curl, and Newton-ring risk.
- Record scanner software assumptions where known: auto exposure, auto color, sharpening, dust removal, infrared cleaning, embedded profile, output color space, bit depth, and compression.
- Record camera scan capture metadata where available: exposure, ISO, aperture, lens, RAW white balance, black level, clipping state, and light-source white balance.
- Add a Scan Setup Check panel before conversion that reports missing profile, clipped channels, auto-white-balanced files, auto-contrast files, unknown lab correction, missing clear film base, uneven illumination, severe light-source casts, per-channel underexposure, lab JPEG compression, and flatbed sharpening artifacts.
- Provide scanner export guidance in docs and UI: prefer 16-bit TIFF/DNG or camera RAW, disable auto color/auto contrast where possible, preserve borders when possible, and avoid pre-inverted positives for Negative Lab conversion.
- Warn when conversion confidence is low because the input is already heavily processed or lacks enough film base data.

Negative Lab acquisition contract:

- Acquisition metadata is part of the roll/session schema and sidecar, not transient UI state.
- Required acquisition fields: acquisition method, capture device, scanner/camera model where known, lens where known, scanner software where known, light source, light-source confidence, visible base state, rebate/border state, suspected scanner auto adjustment, compression artifact score, channel clipping score, uneven illumination score, input color space status, suspected pre-inversion/lab correction, and confidence notes.
- `acquisition_method` values should include `camera_raw`, `camera_tiff`, `flatbed_tiff`, `lab_tiff`, `lab_jpeg`, `contact_sheet`, and `unknown`.
- `input_color_space_status` values should include `embedded_icc`, `assumed_srgb`, `assumed_scanner_rgb`, and `unknown`.
- Acquisition profiles must be serializable, versioned, diffable, reusable across rolls, and separable from process/stock profiles.
- Unknown acquisition assumptions should remain visible in the UI, command dry-runs, output reports, and app-server agent responses.
- Acquisition confidence must affect whether auto base, roll normalization, named-stock profile application, or batch operations can proceed without explicit user approval.

Negative Lab failure-mode taxonomy:

| Failure mode                            | Detection signal                                            | Product behavior                                                        |
| --------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| No clear film base visible              | base candidate search fails                                 | block auto base and require manual, roll-level, or reference sample     |
| Clipped orange mask/base                | per-channel clipping near base samples                      | warn that color recovery is limited and lower conversion confidence     |
| Lab JPEG already color-corrected        | histogram, metadata, compression, or baked-in clues         | allow creative edit, but label objective conversion as low confidence   |
| Scanner auto exposure/auto color        | inconsistent base/neutral behavior across frames            | warn before roll normalization and require dry-run evidence             |
| Mixed process in one roll/contact       | incompatible frame solves or process metadata               | prevent global roll match by default                                    |
| Cross-processed film                    | process/stock mismatch or abnormal channel behavior         | switch to experimental profile mode with explicit warnings              |
| Dense underexposed negative             | low transmittance and shadow-channel noise                  | recommend exposure/base override and flag shadow recovery limits        |
| Thin overexposed negative               | low density separation and highlight fragility              | reduce confidence and protect highlights                                |
| Expired or poorly stored film           | inconsistent base/fog/color across frames                   | allow frame-local overrides and avoid broad roll assumptions            |
| Redscale or creative color negative     | abnormal channel relationships                              | require creative/experimental profile and avoid exact-stock language    |
| Rebate, sprocket, or dust contamination | base sample overlaps border text, dust, holes, or scratches | reject/flag sample and require replacement or lower-confidence override |

Roll/session model requirements:

- Negative Lab creates a roll/session entity, not just independent per-image edits.
- A roll stores input mode, process family, scanner/camera profile, light-source assumptions, film holder/copy setup notes, shared base samples, frame list, anchor frames, roll-level defaults, per-frame overrides, rejected samples, and validation warnings.
- Each frame stores crop, rotation, perspective correction, base sample links, conversion operation parameters, QC status, and provenance to the original scan.
- Roll-level settings can be applied to all frames, selected frames, or frames matching warning states.
- Per-frame overrides must be explicit and reversible.
- Copy/paste and sync must support all, selected, and safe-only operations.
- Converted positives must remain linked to the original negative scan and roll/session settings.

Profile class boundaries:

- `AcquisitionProfile`: camera/scanner/light-source/input-transform assumptions, including input profile, light source, lens/copy-stand correction, scanner software assumptions, and capture limitations.
- `ProcessProfile`: process-family conversion assumptions such as C-41, black-and-white silver, chromogenic black-and-white, ECN-2, E-6 helper, redscale, or creative/experimental negative handling.
- `StockProfile`: stock-family or measured-stock rendering/profile data, including default conversion/rendering choices and provenance.
- Film stock profiles must not encode scanner correction, light-source correction, lens shading correction, or lab-specific baked-in assumptions. Those belong to acquisition profiles.
- The command API, sidecar schema, preset registry, UI, and app-server tools must expose the profile class touched by each operation.
- Profile migrations must preserve these boundaries so old stock presets cannot silently become acquisition corrections or vice versa.

Primary workflow:

1. Import scans: choose source type, roll/session, scanner/camera profile, light-table white balance, process family, and expected frame format.
2. Detect frames: split multi-frame scans, crop, rotate, straighten, detect borders/rebate, and flag ambiguous crops.
3. Calibrate base: run auto base detection, collect manual multi-point samples, reject contaminated samples, and save roll-level base/fog statistics.
4. Convert: choose process mode and preset tier, then tune inversion, density, RGB balance, black point, white point, contrast, and color cast.
5. Normalize roll: select anchor frames, sync exposure/color/density, apply per-frame overrides, and flag outliers.
6. QC: inspect clipping, density, channels, skin sample readouts, neutral sample readouts, crop warnings, and batch consistency warnings.
7. Output: save positive variants with provenance, continue editing in the normal RawEngine editor, or export with recipes.

Frame detection and crop requirements:

- Detect single frames, strips, contact sheets, and scans with uneven borders.
- Support manual crop and rotation correction when detection is wrong.
- Avoid using rebate/border text as film base.
- Flag likely contaminated base samples near edges, dust, sprocket holes, light leaks, and frame numbers.
- Preserve original negative scan orientation and allow non-destructive display rotation.
- Store crop and split operations as versioned edit graph operations.
- Support half-frame, panoramic frames, 110/126/APS formats, medium format, sheet film, mixed orientation strips, overlapping frames, contact sheets containing multiple film stocks or processes, and scans containing both negatives and positives.

Film base and calibration requirements:

- Manual film base picker.
- Auto film base detection with confidence score.
- Multi-point base sampling.
- Rejected base sample list.
- Roll-level base/fog model.
- Per-frame base override.
- Light-table/camera white balance input.
- Scanner profile input.
- Camera scanning profile input.
- Lens correction and illumination correction handoff for camera-scanned negatives.
- Calibration notes for copy stand, macro lens, light source, holder, and scanner.
- Optional ColorChecker, IT8, gray card, step wedge, and densitometer/spectrophotometer metadata workflows.
- Known-target calibration mode when a scan includes a usable reference target.
- No-target calibration mode with lower confidence and stronger warnings.
- Saved scanner/camera/light-source profile independent from film stock profile.

Image processing and color-science requirements:

- Convert input to a known linear working space before negative conversion.
- Separate capture/scanner correction from creative post-inversion color correction.
- Model film base as per-channel Dmin/base/fog using robust multi-sample statistics.
- Perform inversion in a defined density/transmittance domain, not arbitrary display RGB.
- Support process-specific conversion profiles for C-41, ECN-2, black-and-white silver, chromogenic black-and-white, redscale/creative color, and E-6 slide helper mode.
- E-6 slide/reversal helper mode must not run negative inversion; it should provide profile/display correction and scan cleanup.
- Define characteristic curve parameters: toe, linear section, shoulder, gamma/contrast index, per-channel dye behavior, and output contrast curve.
- Provide per-channel inversion curves.
- Provide RGB balance after inversion.
- Provide density/exposure normalization.
- Provide black point and white point controls.
- Provide color cast correction.
- Preserve highlight and shadow recovery opportunities after conversion where the source data allows it.
- Define where negative conversion lives in the edit graph relative to RAW decode, lens correction, scene-referred color, film simulation, grain, halation, and creative grading.
- Define exact pipeline placement relative to demosaic, lens correction, white balance, denoise, sharpening, global edits, masks, display transform, and export before implementation.
- Lens and illumination correction usually need to happen before base sampling for camera scans, but coordinate transforms for crops and frame boundaries must remain replayable.
- Sharpening should not happen before objective inversion.
- Denoise should not happen before objective inversion unless an ADR defines a bounded raw-domain or scanner-domain noise model.
- Capture-light correction may happen before density conversion; creative white balance belongs after inversion.
- Film grain and halation controls are creative post-conversion operations unless a future ADR proves a better model.
- CPU and GPU renders must have explicit parity tolerances before the feature ships.
- Intermediate math must define numeric ranges, clamping policy, NaN/Inf behavior, monotonicity rules for objective curves, deterministic replay rules, and canonical CPU reference output.
- Use documented, open, vendor-neutral color-management primitives. RawEngine may interoperate with ICC, ColorSync on macOS, ACES/OCIO-style transforms, and DNG/ICC metadata, but must not depend on proprietary Adobe/Capture One transforms, profiles, or LUTs.
- macOS preview must be display-profile aware where appropriate and must not assume every display is sRGB.
- Include sRGB, Display P3, and future HDR-display preview validation paths even if HDR export is deferred.

Negative Lab edit graph placement:

- Exact placement must be finalized by ADR before implementation, but the starting architecture target is: RAW decode/demosaic, raw black/white normalization, bounded lens shading or vignetting correction when needed, acquisition input transform, film base/fog estimation, density/transmittance conversion, process/stock profile transform, roll normalization, objective positive rendering, normal RawEngine edit graph, then display/output transform.
- User creative edits, masks, sharpening, LUTs, HSL, general tone tools, film grain, halation, and creative color grading must not run before objective negative inversion unless an ADR explicitly allows a bounded pre-inversion operation.
- Denoise before objective inversion is prohibited unless an ADR defines a bounded raw-domain or scanner-domain noise model and fixture gates.
- The normal editor may operate on generated positive variants after Negative Lab creates a linked, provenance-bearing positive operation.
- A positive variant must remain traceable to original scan, acquisition profile, process profile, stock/profile selection, base samples, roll/session parameters, command log, and output profile.

Negative math invariants:

- All density-domain operations must operate on linearized input.
- Density/transmittance buffers must reject or explicitly guard NaN, infinity, zero/negative transmittance, and unbounded log-domain values.
- Per-channel base/fog estimates must be versioned, reproducible, and tied to accepted sample regions.
- Per-channel objective curves must be monotonic unless a creative/experimental mode explicitly opts out and is labeled as such.
- CPU reference output is canonical for correctness; GPU output must match within documented tolerances.
- Every profile must declare which parameters it touches and whether those parameters are objective, semi-objective, or creative.
- Every command must produce a parameter diff, warning list, provenance entry, and deterministic replay record.
- Expert mode and API responses should be able to expose intermediate debug artifacts: linear input preview, estimated base map, transmittance preview, density preview, per-channel curve preview, objective positive preview, creative positive preview, and final rendered positive.
- Numeric invariant failures must fail early and visibly rather than being hidden behind a visually plausible render.

Clean-room and inherited-code boundary:

- Existing upstream negative-conversion code must be audited before extension.
- RawEngine may retain compatible open-source code according to license obligations, but the new Negative Lab architecture must document which pieces are inherited, rewritten, isolated, or replaced.
- Any algorithmic borrowing from external projects must be license-compatible, cited in source/docs, and validated against RawEngine's CPU reference and fixture gates.
- Professional Negative Lab requirements should drive the architecture; inherited hobby-grade inversion behavior must not become an implicit product constraint.

Measurement and processing boundary requirements:

- Acquisition calibration, objective inversion, roll normalization, and creative rendering must be separate stages in the edit graph, command API, UI, and validation artifacts.
- Acquisition calibration covers scanner/camera input profile, light source, white balance, lens/copy-stand corrections, flat-field/illumination correction, and scan-source limitations.
- Objective inversion covers film base/fog estimation, density/transmittance conversion, per-channel inversion, characteristic curves, process-family assumptions, and output neutralization targets.
- Roll normalization covers anchor frames, shared base samples, exposure/density/color sync, outlier detection, and explicit per-frame overrides.
- Creative rendering covers post-conversion contrast, color style, film simulation, grain, halation, bloom, and user looks.
- Commands and sidecars must label which stage each operation belongs to so app-server tools, validation, and future migrations can reason about the workflow safely.
- Validation artifacts should be able to show failures at each stage separately instead of only comparing final rendered pixels.
- Each command must declare whether it is `objective`, `semi_objective`, or `creative`.
- Objective commands include acquisition correction, base/fog estimation, density conversion, and process profile application.
- Semi-objective commands include roll normalization, anchor-frame sync, and neutral/skin target matching.
- Creative commands include film look, contrast style, grain, halation, split tone, bloom, and user looks.
- Batch normalization may only change objective and semi-objective parameters unless the user explicitly enables creative sync.
- Presets must declare which objective, semi-objective, and creative parameters they touch.

Professional edge cases:

- Expired film.
- Pushed or pulled film.
- Underdeveloped or overdeveloped negatives.
- Dense negatives.
- Thin negatives.
- Uneven illumination.
- Light leaks.
- Dust and scratches.
- Rebate contamination.
- Mixed-exposure rolls.
- Mixed-light rolls.
- Cross-processed film.
- Remjet/cinema-stock assumptions.
- Lab scans with unknown correction baked in.
- Creative/specialty stocks where exact color is not objectively recoverable.
- Mixed film stocks or process families on one contact sheet.
- Auto-corrected scanner files with unknown positive conversion or baked-in correction.
- Half-frame, panoramic, medium-format, sheet-film, 110, 126, and APS scans.
- Black-and-white panchromatic, orthochromatic, infrared, stained/tanned, chromogenic, pushed, pulled, and specialty cases.
- ECN-2 remjet removed, remjet unknown, C-41 cross-processed cinema film, tungsten/daylight stock assumptions, and still-photo cinema-derived workflows.
- Curled film, uneven focus, Newton rings, sprocket/perf contamination, and scanner-bed border contamination.

Film stock preset requirements:

- Include presets for major film stock families where legally safe.
- Avoid bundled proprietary LUTs, ICCs, or trademark-infringing assets.
- Use neutral or descriptive names for built-in presets unless legal review approves exact stock names.
- Track preset provenance and licensing.
- Support color negative, black-and-white negative, and slide/reversal scan helper workflows.
- Do not claim exact emulation of a branded film stock unless RawEngine has project-owned measurements, fixture IDs, scan setup notes, and legal approval.
- Presets should be starting points for inversion and scan normalization, not final creative promises.
- Every preset must be serializable, API-callable, versioned, and deterministic.
- Preset metadata should include:
  - stock family.
  - process type.
  - preset tier.
  - intended scanner/camera-scan assumptions.
  - base color assumptions.
  - contrast curve.
  - color correction model.
  - grain/texture defaults where appropriate.
  - measured fixture references where available.
  - reference stock-family notes where legally safe.
  - version.
  - legal/provenance note.

Major stock preset governance:

- Create a project-owned film stock registry before shipping stock-family presets.
- Treat "major film stocks" as a maintained coverage target, not a one-time hard-coded list.
- Registry entries should include manufacturer/brand owner, stock family, process type, speed, color/BW/reversal category, current/discontinued/archival status, trademark status, legal naming status, preset tier, fixture status, source references, and refresh date.
- The registry must distinguish current production stocks, discontinued but common archival stocks, cinema stocks commonly scanned by still photographers, creative/specialty stocks, and slide/reversal stocks that use helper profiles rather than inversion.
- Built-in presets should be legally safe stock-family starting points unless a measured profile has project-owned test rolls, scan setup notes, fixture IDs, reproducibility notes, and legal approval.
- Stock-family preset coverage must be visible in the UI and docs as "generic", "verified profile", "user profile", or "reference mapping"; the app must not blur these tiers.
- Each preset needs deterministic output, command/API serialization, semantic versioning, migration behavior, provenance notes, and a deprecation path.
- Preset catalog updates require validation artifacts and review, not only visual preference.
- A scheduled research issue should refresh the registry against official manufacturer sources before each major release.
- Profile confidence tiers must be explicit: generic process preset, stock-family starting point, measured project profile, user profile, and reference mapping.
- Profile imports must warn on missing license/provenance, unsafe claims, unsupported binary LUT/profile payloads, or ambiguous trademark/affiliation language.

Stock-aware registry model:

- RawEngine will maintain a stock-aware registry for major still, cinema, black-and-white, and reversal film families.
- Registry entries support organization, metadata, search, compatibility checks, and safe preset mapping. They do not by themselves imply exact manufacturer emulation.
- Built-in presets are generic or measured/provenanced profiles; they do not claim exact manufacturer emulation unless legal review and measurement data allow it.
- A stock registry entry is factual metadata. A preset/profile is RawEngine-created conversion/rendering data.
- Official product pages and manufacturer technical data sheets may be used to populate factual metadata such as stock name, ISO, format, process family, and availability. They must not be used to copy proprietary color rendering, hidden transforms, manufacturer branding assets, logos, packaging, or claims of exact emulation.
- Registry entries must store source citations and last-reviewed dates because stock availability and manufacturer catalogs change over time.
- Registry updates should be split by function first, then manufacturer/stock family: schema and validator, source citation model, process-family compatibility map, generic preset mapping, manufacturer entries, discontinued/region-limited status, unsafe-name lint, and UI badges.

Stock registry schema targets:

- `stock_id`.
- `manufacturer_display_name`.
- `stock_display_name`.
- `process_family`.
- `film_class`.
- `speed_iso`.
- supported formats.
- status: `active`, `discontinued`, `region_limited`, or `unknown`.
- registry purpose: metadata, compatibility, search, preset mapping, or fixture planning.
- built-in profile status: `none`, `generic_family_mapping`, `measured_project_profile`, or `licensed_profile`.
- default safe profile ID.
- trademark usage status.
- claim level.
- official/source references.
- last reviewed date.
- marketing/release review requirement.

Stock coverage tiers:

- Tier A, registry-only: factual metadata, no built-in profile, optional generic process mapping.
- Tier B, generic family mapping: maps a stock family to a RawEngine generic profile such as `C-41 Portrait Natural 400` with no exact emulation claim.
- Tier C, project-measured profile: built from project-owned or properly licensed scans with measurement method, fixture IDs, scanner/camera assumptions, and review.
- Tier D, licensed profile: distributed under explicit rights from a profile creator, lab, manufacturer, or partner, with naming and claims limited to license terms.
- Tier E, user/community profile: user-imported or community-created; not bundled unless provenance, license, and review are complete.

Legally safe product wording:

- RawEngine will provide stock-aware negative processing through a legally reviewed profile registry.
- Built-in profiles should initially be generic process and stock-family starting points.
- Named-stock or measured profiles require documented source material, RawEngine-owned or properly licensed scans, reproducible measurement methodology, fixture manifests, legal/provenance review, and approved UI/marketing copy.
- User and community profiles may store commercial stock names as user metadata where permitted, but the app must clearly separate user-supplied metadata from RawEngine-provided claims.
- RawEngine must not imply manufacturer endorsement, official status, exact emulation, commercial preset compatibility, or equivalence to Adobe, Capture One, Negative Lab Pro, VSCO, RNI, Mastin, Dehancer, or manufacturer profiles.
- Built-in preset UI must avoid manufacturer logos, packaging art, copied swatches, copied LUTs, copied ICC profiles, copied marketing descriptions, and "exact match" language.
- Preset names and descriptions should be linted for unsafe claims before merge, especially terms such as `exact`, `official`, `manufacturer-approved`, `Capture One`, `Lightroom profile`, `Negative Lab Pro`, and `identical`.
- When a stock-family issue closes as reference mapping only, the UI may show that stock as a research/reference target but must not expose it as a verified RawEngine profile.

Preset tier model:

- Generic built-ins: safe descriptive presets such as `C-41 Neutral 100`, `C-41 Portrait 160`, `C-41 Portrait 400`, `C-41 High-Speed 800`, `C-41 Saturated 100`, `ECN-2 Daylight`, `ECN-2 Tungsten`, `Black-and-White Classic Grain`, `Black-and-White Tabular Grain`, `Black-and-White Ortho`, `Black-and-White Chromogenic`, and `Slide/Reversal Helper`.
- Expanded safe built-in families should include portrait-natural C-41 variants, consumer-warm C-41 variants, vivid fine-grain C-41 variants, muted consumer C-41 variants, panchromatic classic BW variants, fine-grain BW variants, tabular/T-grain BW variants, high-speed BW variants, ortho BW variants, chromogenic BW variants, ECN-2 daylight/tungsten variants, E-6 neutral/vivid helper variants, creative redscale, and expired-color-negative helper profiles.
- Verified profiles: project-measured profiles tied to RawEngine-owned test rolls, fixture IDs, scan/camera setup, process lab or process chemistry, version, and legal status.
- User profiles: user-created profiles built from their own scans and saved with local provenance.
- Reference mappings: optional researched metadata that maps a generic preset to stock families after legal review; these are not exact emulation claims.

Major stock-family research coverage:

- Kodak still color negative, including Portra, Ektar, Gold, and UltraMax-style families.
- Kodak still black-and-white, including Tri-X and T-Max-style families.
- Kodak motion/cinema families, including Vision3 daylight/tungsten color negative, Double-X black-and-white negative, Ektachrome reversal, Tri-X reversal, and newer motion families where current.
- Fujifilm color negative, slide/reversal, and black-and-white families where still relevant to users and archival scans.
- Ilford and Kentmere black-and-white families, including classic cubic-grain, tabular-grain, chromogenic, infrared/specialty, and ortho families.
- Foma black-and-white families, including classic, creative/action, retropan, cine, ortho, and reversal families.
- Harman color and creative color families, including Phoenix/Switch/Red-style workflows.
- CineStill-style still-photo cinema-derived color negative workflows, with naming and trademark review.
- Lomography standard color negative and LomoChrome-style creative color families.
- Adox black-and-white, specialty, and reversal families.
- Ferrania P30-style black-and-white workflows.
- Rollei/Agfa-style black-and-white families, with naming and trademark review.
- Slide/reversal helper profiles as a separate mode, not negative inversion.

Preset coverage backlog:

- Create one registry coverage issue per manufacturer or stock family when this milestone starts, instead of one oversized preset PR.
- Initial registry must cover at least color negative, black-and-white silver, chromogenic black-and-white, ECN-2/cinema negative, creative color negative, and slide/reversal helper categories.
- Each stock-family issue should decide whether the output is a generic built-in, measured verified profile, user-profile template, or reference mapping only.
- Each stock-family issue should include fixture needs, legal naming decision, expected scan assumptions, preset tier, validation artifacts, UI copy, and agent/API command examples.
- Stock-family issues should be allowed to close as "reference mapping only" when legal or measurement evidence is insufficient.

Preset research seed sources:

- Kodak Alaris professional still-film resources: <https://kodakprofessional.com/photographers/resources>
- Kodak motion camera films: <https://www.kodak.com/en/motion/products/camera-films/>
- Fujifilm negative and reversal films: <https://www.fujifilm.com/uk/en/consumer/films/negative-and-reversal>
- Ilford technical data: <https://www.ilfordphoto.com/technical-data/>
- Foma black-and-white film catalog: <https://www.foma.cz/en/catalogue-bw-film-324>
- Harman Phoenix/color-film range: <https://www.harmanphoto.co.uk/phoenix/>
- CineStill film stock guide: <https://cinestillfilm.com/blogs/news/cinestill-film-stock-primer>
- Lomography film catalog: <https://shop.lomography.com/film/all>
- Adox support and film families: <https://www.adox.de/support/>
- Ferrania P30 information: <https://www.filmferrania.com/p30-info>

Negative lab validation:

- Color negative scan fixtures.
- Black-and-white negative fixtures.
- Camera-scanned negative fixtures.
- Flatbed-scanned negative fixtures.
- Lab-scanned negative fixtures where license permits.
- Mixed-exposure roll fixtures.
- Dense negative fixture.
- Thin negative fixture.
- Strong orange mask fixture.
- Border/crop detection fixture.
- Batch consistency fixture.
- Skin tone fixture after inversion.
- Neutral gray fixture after inversion.
- Camera RAW negative fixture with visible border.
- Camera TIFF negative fixture with known light-source white balance.
- Flatbed TIFF negative fixture with scanner profile.
- Multi-frame strip/contact-sheet fixture.
- Lab scan fixture with baked-in correction warning.
- Pushed and pulled film fixtures.
- Expired film fixture.
- Uneven illumination fixture.
- Dust/scratch and contaminated-base fixture.
- ECN-2 daylight and tungsten fixtures.
- Black-and-white ortho/specialty fixture.
- Slide/reversal positive scan helper fixture.
- Creative color fixture with explicit non-exact-emulation warning.

Negative lab shift-left gates:

- `validation:negative-lab:schema`: command schema, sidecar schema, preset metadata schema, registry schema, migrations, and provenance roundtrip.
- `validation:negative-lab:fixtures`: fixture manifest lint, license/provenance lint, expected input profile checks, and missing-fixture failure modes.
- `validation:negative-lab:fixture-storage`: public/private fixture location checks, redistribution flags, public-repo permission checks, private-CI-only flags, and manifest/storage consistency.
- `validation:negative-lab:cpu-reference`: CPU reference conversion for small fixtures with pinned algorithm versions and reproducible artifacts.
- `validation:negative-lab:gpu-parity`: GPU preview/render comparison against CPU reference within documented tolerances.
- `validation:negative-lab:preset-registry`: major-stock registry coverage, tier labels, legal naming status, source references, and stale-source warnings.
- `validation:negative-lab:profile-scope`: every preset/profile declares touched parameters, objective/semi-objective/creative scope, confidence tier, profile class, and migration behavior.
- `validation:negative-lab:ui-artifacts`: screenshot/contact-sheet artifacts for guided mode, batch mode, Preset Studio, QC Proof, and warning states.
- `validation:negative-lab:ui-alignment`: WGPU/React overlay coordinate checks for sample points, frame boundaries, split/wipe views, Retina scale factors, and density readout pixel accuracy.
- `validation:negative-lab:agent`: app-server dry-run, preview, diff, selected-frame scope, rollback, and no-original-overwrite tests.
- `validation:negative-lab:synthetic`: synthetic negative generator with known positives, known base/fog, known per-channel curves, exposure offsets, scanner/camera matrices, gray ramps, color ramps, and skin-tone patches.
- `validation:negative-lab:numeric`: no NaN/Inf, monotonic objective curves, CPU deterministic hash, CPU/GPU patch tolerance, clipping warning correctness, schema migration, and undo/replay equivalence.
- `validation:negative-lab:warnings`: warning stability checks so missing-base, clipped-channel, lab-JPEG, auto-corrected-scan, mixed-process, mixed-stock, profile-mismatch, unsafe-profile, and no-overwrite warnings cannot be weakened accidentally.
- `validation:negative-lab:claims`: prohibited LUT/profile/binary additions, unsafe trademark/emulation claims, and unapproved exact-match quality claims.
- `validation:negative-lab:performance`: macOS preview latency, preset switch latency, base recalibration time, full-resolution render time, batch throughput, memory ceiling, fallback behavior, and cancellation latency.
- Heavy fixtures can live in an optional artifact pack, but each PR must still run a small deterministic fixture set locally and in CI.
- Public CI should run synthetic and redistributable real fixtures. Release gates should be able to run private/proprietary fixture packs from approved artifact storage without placing restricted images in the public repository.

Negative lab validation matrix:

| Case                            | Inputs                                | Required evidence                                                              |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| C-41 camera scan                | RAW/DNG with visible border           | base sample record, positive render, parameter snapshot, CPU/GPU parity result |
| C-41 flatbed scan               | TIFF plus scanner profile             | profile record, positive render, neutral patch notes                           |
| Lab scan                        | TIFF/JPEG with unknown lab correction | limitation warning, positive variant provenance                                |
| Dense/thin negatives            | known hard fixtures                   | clipping report, density report, before/after artifact                         |
| Mixed roll                      | 6+ frames                             | anchor frame, sync deltas, per-frame overrides                                 |
| Black-and-white panchromatic    | silver negative                       | tonal curve, grain/detail crop                                                 |
| Black-and-white ortho/specialty | ortho or specialty fixture            | spectral/look note, manual adjustment evidence                                 |
| ECN-2/cinema negative           | daylight and tungsten cases           | process assumption, halation/remjet note, render artifact                      |
| Creative color                  | Harman/Lomo-style fixtures            | warning that output is profile-assisted, not exact emulation                   |
| Slide/reversal helper           | E-6 positive scan                     | no inversion operation, profile/display helper only                            |
| Multi-frame scan                | strip/contact-sheet input             | frame split artifact, crop warnings, replayable operations                     |

Negative lab fixture manifest requirements:

- No real scan, target image, profile, LUT, ICC, or rendered golden artifact should enter the repository or artifact store without a manifest.
- Manifest fields should include fixture ID, source URL or local acquisition record, rights/license status, copyright owner, photographer or lab, contributor, hash, redistribution permission, public repository permission, private-CI-only flag, capture method, scanner/camera/lens profile, light source, scanner software, scan settings, embedded profile, process family, film stock or stock family where known, development notes where known, bit depth, color profile, compression, border visibility, frame count, known defects, expected warnings, allowed use, reviewer, review date, and review status.
- Calibration-target fixtures should also record target type, target batch or reference data where legally usable, patch geometry, measurement device or reference source, expected DeltaE thresholds, and reviewer.
- Negative-specific fixtures should record known base/fog sample regions, rejected sample regions, anchor frames, expected density range, dense/thin/clipping expectations, and expected process/profile assumptions.
- Golden fixtures should record algorithm/profile version, command sequence hash, CPU reference hash, GPU tolerance, expected output hash or perceptual hash, reviewer, review date, and whether a golden-output update requires explicit approval.
- Fixture manifests must distinguish synthetic fixtures, project-owned measured scans, public sample images, user-provided fixtures, and restricted local-only fixtures.
- Heavy or restricted fixtures may live outside the git repository, but their manifests, hashes, and validation purpose should still be tracked.
- CI must fail if any fixture image lacks a manifest or if a manifest does not permit the configured storage location.
- Golden output updates must require an explicit review path or approval label.

Numeric and perceptual quality gates:

- Blocking math gates: no NaN/Inf outputs, guarded zero/negative transmittance handling, no unintended negative density, monotonic objective curves unless a creative mode explicitly opts out, deterministic CPU reference output, stable schema migration, and undo/replay equivalence.
- Blocking warning gates: clipped-channel warnings, missing-base warnings, contaminated-base warnings, lossy-input warnings, baked-in scanner correction warnings, and low-confidence calibration warnings must fire predictably on fixtures.
- CPU/GPU gates: small fixtures must compare against the CPU reference within documented per-channel and patch-level tolerances; shader changes require parity evidence before merge.
- Color-target gates where reference data exists: DeltaE2000 thresholds for neutral patches, ColorChecker patches, gray ramp neutrality, highlight/shadow clipping tolerance, saturation preservation, and hue rotation tolerance for memory colors.
- Non-target gates where reference data does not exist: perceptual hash or SSIM against approved goldens, histogram-shape tolerance, density-summary stability, warning stability, and human-reviewed golden approval for intentional visual changes.
- Preset gates: registry coverage, tier labeling, source references, legal naming status, stale-source warnings, deterministic output, migration behavior, and prohibited-claim lint.
- Profile/preset gates: every preset has a provenance manifest, every profile declares parameter scope and confidence tier, every measured profile references fixture IDs, every named-stock measured profile references legal/review approval, and no bundled profile contains unapproved binary LUT/ICC/profile payloads.
- Prohibited preset/profile wording should include unsafe strings such as `exact`, `official`, `manufacturer approved`, `Capture One`, `Lightroom`, `Adobe`, `NLP`, `Negative Lab Pro`, `VSCO`, `RNI`, `Mastin`, `Dehancer`, `Fuji simulation`, and `Kodak LUT` unless explicitly approved by legal/provenance review.
- Batch gates: single-frame command equivalence to batch command output, roll normalization repeatability, selected-frame scope enforcement, cancellation latency, no-original-overwrite behavior, and positive variant provenance.
- Preview/full-resolution consistency gates must catch mismatches between the interactive preview path and export path.

UI alignment regression gates:

- Overlay coordinate equals sampled image coordinate.
- Base sample rectangle stays aligned after zoom.
- Frame boundary stays aligned after rotate.
- Split/wipe view stays aligned after pan.
- Retina scale factor does not shift overlays.
- WGPU image does not bleed under panels.
- Density readout samples the intended pixel.
- Contact-sheet frame rectangles remain stable through pan, zoom, rotate, and crop replay.

UI workflow regression gates:

- Open the Negative Lab workspace from the app shell.
- Import a single-frame camera scan and a multi-frame strip/contact-sheet fixture.
- Create or select a roll/session.
- Detect frames, manually adjust a frame boundary, and persist the operation.
- Pick, reject, and re-pick base samples with confidence feedback.
- Apply a generic C-41 profile, a black-and-white profile, and a slide/reversal helper profile.
- Compare presets in Preset Studio without committing all variants to the edit graph.
- Save a user profile and verify provenance.
- Create a positive variant linked to the original negative and roll/session.
- Run a batch dry-run and inspect warnings before applying.
- Generate a QC proof/contact sheet and conversion report.
- Invoke the app-server dry-run path for inspect, plan, compare, apply, QC, rollback, and export commands.
- Verify low-confidence calibration, unsafe profile import, destructive export, and broad batch actions require explicit approval.

macOS performance and reliability gates:

- Benchmark matrix should include an Apple Silicon baseline Mac, an Intel Mac only if still supported, a 24MP RAW camera scan, a 45-60MP RAW camera scan, a large 100MP stitched/contact-sheet TIFF, a 12-frame roll batch, and a 36-frame roll batch.
- Track initial preview time, base recalibration time, preset switch time, frame-boundary adjustment latency, full-resolution render time, contact-sheet generation time, batch export throughput, peak memory, GPU fallback behavior, cancellation latency, and app-server progress-event latency.
- Performance regressions should be visible in PR artifacts even when they are not yet blocking.
- Interactive preview targets should be set per milestone before implementation starts; do not accept a UI shell that hides slow conversion behind blocking spinners.

Output and roundtrip requirements:

- Export positive TIFF/JPEG/PNG with embedded profile where applicable.
- Export sidecar/session/profile data independently from rendered positives.
- Export contact-sheet proofs and diagnostic before/after reports for roll review.
- Export negative conversion parameters as JSON for debugging and reproducibility.
- Re-import RawEngine negative profiles into another project with migration checks.
- Use no-overwrite defaults, atomic export writes, batch dry-run summaries, and visible provenance.

Professional lab deliverables:

- Roll proof sheet.
- Frame-by-frame QC report.
- Conversion confidence report.
- Profile/provenance report.
- Sidecar/session export.
- Profile export.
- Before/after contact sheet.
- Per-frame warnings CSV/JSON.
- Reproducible command log.
- Archive package containing inputs, session metadata, profile manifests, output checksums, and compatibility notes where rights allow packaging inputs.
- Public-facing claim/limitation report that explains low-confidence inputs, unsupported stock claims, and conversion assumptions.

API and app-server agent requirements:

- Every negative lab operation must be callable through typed command APIs.
- Commands must be replayable, serializable, undoable, and batchable.
- The UI and app-server agent must use the same command envelope.
- Agent tools may propose or apply roll/session settings, base samples, frame crops, preset choices, and per-frame overrides only through non-destructive operations.
- Agent tools must return preview artifacts, warnings, and parameter diffs before destructive exports or bulk operations.
- Agent tools must never overwrite original scans.
- Agent tools must preserve provenance from original negative scan to positive variant.
- Agent tools must expose safe read-only inspection commands for density, clipping, channels, sample points, and roll consistency.
- Bulk agent operations must support dry-run, selected-frame scope, and rollback.
- Agent tools must expose warning severity, progress events, cancellation, output overwrite policy, batch job IDs, content-hashed preview artifacts, and parameter diffs.
- Agent tools must require explicit human approval for low-confidence calibration, destructive exports, profile imports with missing provenance, and large batch changes.
- Agent tools must operate within user-granted input/output roots and must never silently expand file scope.
- Integration tests must prove dry-run is required before batch apply, dry-run includes affected frames, parameter diffs, and warnings, no-overwrite is default, cancellation leaves no partial sidecar mutation, failed export leaves no corrupt output, agent actions are recorded in provenance, replay after app restart is deterministic, and command schema version mismatch fails safely.

Agent-specific negative lab workflows:

- Inspect scan: report input profile, process-family guess, frame count, base-sample candidates, density range, crop warnings, and fixture/provenance gaps.
- Plan conversion: propose roll/session settings, preset tier, base sampling strategy, anchor frames, and validation checks without applying changes.
- Apply conversion: create non-destructive operations only after a dry-run diff and selected-frame scope are explicit.
- Compare presets: render a bounded comparison grid for selected generic, verified, user, or reference presets.
- Normalize roll: propose exposure/density/color sync from anchor frames, list outliers, and require explicit scope for bulk changes.
- QC roll: return warnings, contact-sheet artifacts, clipping/density summaries, and suggested manual review points.
- Export positives: produce positive variants or export recipes without overwriting originals and with provenance attached.

Negative lab ADRs:

- `ADR-NEG-001: Negative lab architecture and edit graph integration`
- `ADR-NEG-002: Density-domain inversion model`
  ([draft ADR](docs/negative-lab/density-domain-inversion-adr-2026-06-13.md))
- `ADR-NEG-003: Input profile strategy for camera, flatbed, and lab scans`
  ([draft ADR](docs/negative-lab/input-profile-strategy-adr-2026-06-13.md))
- `ADR-NEG-004: Film base sampling and roll-level calibration`
- `ADR-NEG-005: Roll consistency and batch application semantics`
- `ADR-NEG-006: Preset naming, trademark, provenance, and legal policy`
  ([draft ADR](docs/negative-lab/preset-naming-legal-policy-2026-06-13.md))
- `ADR-NEG-007: Built-in preset taxonomy and stock refresh cadence`
- `ADR-NEG-008: Positive variant/export provenance`
- `ADR-NEG-009: Negative fixture corpus and validation thresholds`
- `ADR-NEG-010: Negative Lab node placement and allowed upstream operations`
- `ADR-NEG-011: Open color management, display profile, and export profile policy`
- `ADR-NEG-012: Objective, semi-objective, and creative operation contract`
- `ADR-NEG-013: Synthetic negative generator and numeric quality gates`
- `ADR-NEG-014: App-server safety model, file scope, dry-run, and rollback`
- `ADR-NEG-015: Acquisition fixture manifest and provenance contract`
  ([draft policy](docs/negative-lab/fixture-licensing-provenance-policy-2026-06-13.md))
- `ADR-NEG-016: Named stock-profile measurement methodology and claims policy`
- `ADR-NEG-017: Dedicated Negative Lab UI workflow architecture`
- `ADR-NEG-018: Negative Lab performance budgets and macOS benchmark matrix`
- `ADR-NEG-019: AcquisitionProfile, ProcessProfile, and StockProfile separation`
- `ADR-NEG-020: WGPU overlay coordinate contract`
- `ADR-NEG-021: Upstream negative-conversion audit`
- `ADR-NEG-022: Negative Lab profile schema versioning and migration`

Negative lab implementation order:

1. Consult and ADRs: complete design review, architecture ADRs, density model ADR, preset naming/legal ADR, fixture policy, and command namespace.
2. Foundations with no pixel changes: add operating principles, non-goals, acquisition contract, failure-mode taxonomy, profile class boundaries, session/profile/provenance schemas, schema snapshots, unsafe-name lint, and fixture manifest lint.
3. Lab shell and command bus: add Negative Lab route behind a feature flag, stage navigator, roll cockpit placeholder, frame health grid placeholder, expert inspector placeholder, command envelope, dry-run response type, warning severity model, parameter diff model, command provenance model, and serialization roundtrip tests.
4. Acquisition diagnostics: classify camera/scanner/lab inputs, detect embedded profile status, likely JPEG/lab-processed inputs, clipping, visible-base candidates, uneven illumination, and acquisition warning overlays.
5. CPU reference path: implement a small deterministic CPU inversion path for curated fixtures so UI and GPU behavior has a stable baseline.
6. Viewer and expert tools: add density view, base-corrected negative view, objective positive view, split/wipe comparison, channel solo, clipping/gamut overlays, densitometer readout, base sample tool, and overlay coordinate alignment tests.
7. Input and frame handling: support camera RAW/DNG, TIFF, flatbed/lab scan metadata, contact-sheet splitting, crop/rotation, and contaminated-base warnings.
8. Base and inversion tools: add manual/auto base sampling, density-domain inversion controls, per-channel curves, black/white point, neutral/skin sample targets, and stage-labeled operations.
9. Roll operations: add anchor selection, scene grouping, exposure/density/color sync, frame override diffs, roll matching console, normalize-roll dry-run, outlier reports, contact-sheet artifacts, and batch-safe sync operations.
10. Stock registry without measured-profile overclaims: add stock registry schema, source citation model, claim-level enum, generic process preset mapping, manufacturer metadata entries, profile confidence badges, stock registry browser, and stock registry authoring docs.
11. Preset/profile expansion: ship generic safe presets first, then measured verified profiles, user profiles, and reference mappings through small stock-family issues.
12. GPU and performance: port validated CPU stages to GPU with parity tolerances, preview latency budgets, memory ceilings, contact-sheet benchmarks, and fallback behavior.
13. Agent tools: expose inspect, plan, dry-run, compare, apply, QC, rollback, and export tools through the app-server command layer with no-overwrite and provenance gates.
14. Output and audit: add positive exports, proof sheets, QC reports, session archives, preview artifacts, atomic failure handling, and migration tests.
15. Release hardening: add fixture packs, large/nightly validation, documentation, migration tests, accessibility checks, and manual editing workflow sign-off.

Negative lab issue split:

- `consult(negative-lab): get negative processing lab design review`
- `negative-lab(adr): define negative processing architecture`
- `negative-lab(adr): define density-domain inversion model`
- `negative-lab(adr): define preset naming and legal policy`
- `negative-lab(adr): define acquisition process and stock profile boundaries`
- `negative-lab(adr): define WGPU overlay coordinate contract`
- `negative-lab(adr): audit upstream negative conversion logic`
- `negative-lab(adr): define profile schema versioning and migration`
- `negative-lab(ui): design dedicated negative lab workspace`
- `negative-lab(ui): add roll setup and frame queue design`
- `negative-lab(ui): add QC overlays and sample readouts design`
- `negative-lab(ui): add roll cockpit and frame health grid design`
- `negative-lab(ui): add expert densitometer inspector design`
- `negative-lab(ui): add base sampling studio design`
- `negative-lab(ui): add roll matching console design`
- `negative-lab(ui): add profile comparison matrix design`
- `negative-lab(ui): add agent activity and command provenance panel`
- `negative-lab(schema): define negative conversion operation schema`
- `negative-lab(schema): define acquisition profile schema`
- `negative-lab(schema): define process and stock profile schemas`
- `negative-lab(schema): define negative lab provenance record schema`
- `negative-lab(api): expose negative lab command surface`
- `agent(negative-lab): expose safe app-server tools for negative lab`
- `negative-lab(acquisition): add scan setup health model`
- `negative-lab(acquisition): detect auto-corrected and lossy inputs`
- `negative-lab(acquisition): add durable acquisition contract`
- `negative-lab(acquisition): add failure-mode taxonomy`
- `negative-lab(import): support scan input modes and roll sessions`
- `negative-lab(import): add frame splitting and border detection`
- `negative-lab(format): support half-frame panoramic medium-format and sheet-film scans`
- `negative-lab(calibration): add target and step-wedge workflows`
- `negative-lab(base): add film base sampling controls`
- `negative-lab(inversion): add per-channel inversion curves`
- `negative-lab(contract): classify objective semi-objective and creative operations`
- `negative-lab(color-management): define display and export profile behavior`
- `negative-lab(color): add density normalization and process profiles`
- `negative-lab(bw): add black-and-white process model`
- `negative-lab(ecn2): add remjet and cinema scan assumptions`
- `negative-lab(batch): add roll-level batch consistency workflow`
- `negative-lab(presets): define film stock preset metadata and legal policy`
- `negative-lab(presets): create major film stock registry schema`
- `negative-lab(registry): define stock coverage tiers and claim levels`
- `negative-lab(registry): add stock source citation and review model`
- `negative-lab(registry): add generic process preset mapping`
- `negative-lab(presets): add stock registry refresh workflow`
- `negative-lab(presets): add preset provenance inspector requirements`
- `negative-lab(presets): add generic legally safe built-in presets`
- `negative-lab(presets): add stock-family research mappings after legal review`
- `negative-lab(presets): add measured-profile fixture format`
- `negative-lab(presets): define named stock measurement methodology`
- `negative-lab(presets): add user and community profile provenance rules`
- `negative-lab(presets): split major stock-family coverage issues`
- `negative-lab(crop): add frame border and crop detection`
- `negative-lab(profiles): add scanner and camera-scan profile inputs`
- `negative-lab(qc): add contact sheet proofing reports`
- `negative-lab(qc): add density and clipping warning reports`
- `negative-lab(output): add positive variant provenance`
- `negative-lab(output): add conversion report and profile roundtrip exports`
- `validation(negative-lab): add negative scan fixture manifest`
- `validation(negative-lab): add fixture licensing and provenance policy`
- `validation(negative-lab): add calibration target fixture manifest`
- `validation(negative-lab): add preset registry lint`
- `validation(negative-lab): add CPU reference conversion fixtures`
- `validation(negative-lab): add synthetic negative generator`
- `validation(negative-lab): add numeric quality gates`
- `validation(negative-lab): add DeltaE gray-ramp and ColorChecker gates`
- `validation(negative-lab): add GPU parity tolerance checks`
- `validation(negative-lab): add prohibited asset and claim lint`
- `validation(negative-lab): add public/private fixture storage lint`
- `validation(negative-lab): add warning stability gates`
- `validation(negative-lab): add profile scope and confidence tier lint`
- `validation(negative-lab): add WGPU overlay alignment tests`
- `validation(negative-lab): add color and black-and-white negative render tests`
- `validation(negative-lab): add roll consistency and QC overlay tests`
- `validation(negative-lab): add full lab UI workflow regression tests`
- `validation(negative-lab): add app-server dry-run and rollback tests`
- `validation(negative-lab): add macOS performance benchmarks`
- `docs(negative-lab): add user guide for negative workflow`

### 7.6 Export And Delivery

Required export capabilities:

- JPEG.
- TIFF.
- PNG.
- AVIF, later phase.
- HEIF/HEIC, macOS later phase if licensing/tooling is safe.
- DNG or DNG-like linear export where feasible.
- 8/16/32-bit export depending on format.
- Color space selection:
  - sRGB.
  - Display P3.
  - Adobe RGB.
  - ProPhoto RGB.
  - Custom ICC.
- Embed ICC.
- Resize.
- Sharpen for output.
- Watermark, later phase.
- Metadata include/exclude.
- Export recipes.
- Batch export.
- Background export queue.
- Export validation previews.

### 7.7 macOS Polish

macOS is the first-class target.

Requirements:

- Native-feeling app bundle.
- Apple Silicon optimization.
- Intel Mac support if practical.
- Color-managed display rendering.
- Retina-safe rendering.
- Trackpad and keyboard workflow.
- macOS menu conventions.
- File association, later phase.
- Quick Look preview, later phase.
- Finder drag/drop.
- Sandboxing/notarization plan for release.
- Crash reporting strategy that respects privacy.
- Local-first behavior.

macOS release/security decisions:

- Decide Developer ID distribution versus Mac App Store strategy.
- Define signing certificate custody.
- Define notarization and stapling workflow.
- Define hardened runtime settings.
- Define entitlements.
- Define file access permissions.
- Define security-scoped bookmark policy if sandboxing is used.
- Define update mechanism and signing-key rotation.
- Define clean-machine Gatekeeper install test.
- Define Apple Silicon GPU/Metal compatibility test.
- Define rollback behavior for auto-update failures.

macOS release issues:

- `release(macos): choose Developer ID versus Mac App Store strategy`
- `release(macos): define signing notarization and stapling pipeline`
- `release(macos): define hardened runtime and entitlements`
- `release(macos): define filesystem permissions and security-scoped bookmark policy`
- `release(update): define updater signing-key custody and rotation`
- `validation(macos): add clean-machine Gatekeeper install test`
- `validation(macos): add Apple Silicon GPU compatibility test`
- `validation(update): add auto-update rollback test`

## 8. Architecture Direction

### 8.1 High-Level Shape

RawEngine should keep RapidRAW's Rust/Tauri/TypeScript/React direction unless the fork audit reveals a strong reason not to.

Target architecture:

- React/TypeScript UI.
- Tauri app shell.
- Rust core for IO, RAW decode orchestration, image operations, sidecar/catalog, and performance-sensitive services.
- WGSL/GPU path for interactive pixel pipeline.
- CPU/headless path for tests, export, and deterministic validation.
- Shared schema package for edit commands, sidecars, API, agent tools, and test fixtures.
- Local service boundary for editor operations.
- Optional app-server process for chat agent integration.

### 8.1.0 Downstream Validation Architecture

Contract-first architecture should be added before large feature work without requiring an immediate rewrite of every existing RapidRAW adjustment.

Target module layout:

- `packages/rawengine-schema/`
  - Source of truth for Zod-authored command, query, graph, artifact, fixture, bridge error, provenance, and app-server tool schemas.
  - Generates or derives JSON Schema, TypeScript types, OpenAI/app-server tool schemas, sample payloads, manifest hashes, and schema-drift snapshots.
  - Uses Zod for TypeScript/runtime validation.
- `src-tauri/src/edit_core/`
  - Pure Rust edit graph and command core with no Tauri, React, or UI coupling.
  - Owns command replay, graph mutation, migration, typed errors, derived artifact records, and deterministic validation entrypoints.
- `src-tauri/src/bridge/`
  - Tauri adapter layer only.
  - Validates incoming JSON against generated contract artifacts, maps typed errors, manages task lifecycle, progress events, cancellation, and artifact/cache handles.
- UI/Zustand client facade:
  - UI becomes a command/query bus client.
  - Existing adjustment snapshot history can remain as a migration facade while command-backed graph nodes are introduced incrementally.
- Future CLI and app-server:
  - Use the same `CommandEnvelopeV1`, query envelope, graph schema, artifact handles, and typed errors as the UI path.

Schema policy:

- Zod is the schema source of truth for TypeScript-facing contracts.
- Rust uses serde structs generated from or contract-tested against the same schema samples; Rust and TypeScript must not become independent schema authorities.
- Rust bridge structs should use `deny_unknown_fields` where practical and sample contract tests where generated parity is not yet automated.
- Schema artifacts must include stable sample payloads for command, query, error, graph, artifact, fixture, and app-server tool cases.
- Schema manifests should record hashes so CI can detect uncommitted generated-output drift.

Bridge policy:

- No new editing bridge should return `Result<T, String>`.
- New bridge calls return typed `BridgeResult<T>` or a typed error envelope with error code, message, severity, retryability, source, validation path, and optional remediation.
- New command results should not return large base64 image payloads. They should return artifact IDs, cache handles, paths controlled by the app, preview handles, or streamed/progress handles.
- Every mutating command needs `expectedGraphRevision`, actor metadata, approval metadata, dry-run/preview options, provenance, and typed result/errors.
- Long-running operations need task IDs, progress events, cancellation, cleanup, and artifact invalidation behavior.
- Sidecars should dual-write legacy RapidRAW adjustments plus `rawengineGraph` until a migration ADR and tests exist.

App-server tool policy:

- App-server tools are generated from the command/query schema registry.
- The app-server must never expose raw Tauri invokes or UI automation as editing tools.
- Mutating tools require dry-run and scoped approval paths before apply.
- Tool outputs should include audit IDs, command IDs, graph revisions, warnings, artifact handles, and follow-up suggestions.
- Tool schema drift, approval enforcement, prompt-injection fixtures, and replay behavior are required validation surfaces.

Edit architecture PR split rule:

- PRs that introduce contracts should be split in this order where practical:
  1. ADR/index documentation.
  2. schema source package or schema file.
  3. generated artifacts and drift check.
  4. sample payloads and contract tests.
  5. Rust serde mirror or generated Rust bindings.
  6. bridge adapter and typed error mapping.
  7. command bus integration.
  8. one representative UI route migration.
  9. replay/headless/app-server exposure.
- Do not combine schema source, bridge adapter, UI migration, and app-server tool exposure in one large PR unless there is no safe intermediate state.
- Every schema PR must document migration, compatibility, generated artifacts, and validation commands.

Downstream contract validation commands to add:

- `bun run schema:check`: validate generated schema artifacts are current.
- `bun run schema:samples`: validate sample command/query/error/graph/artifact/tool payloads.
- `bun run validate:commands`: replay sample commands against the in-memory command bus.
- `bun run validate:bridge`: validate bridge result/error samples and Rust contract fixtures.
- `bun run validate:fixtures`: lint fixture manifests, hashes, storage class, source URLs, and license fields.
- `bun run validate:golden`: run synthetic golden/reference render smoke checks.
- `bun run validate:tools`: validate generated app-server tool schemas and approval metadata.
- `bun run validate:artifacts`: validate derived artifact provenance and invalidation samples.

Fixture and golden image policy:

- Start with synthetic fixtures for schema, coordinate, mask, artifact, warning, and golden-reference validation.
- Add real RAW/image fixtures only after fixture license, hash, provenance, storage, and privacy policy lands.
- Synthetic fixtures are still first-class: they need generation source, deterministic parameters, expected warnings, and output hashes where applicable.
- Real fixtures must not enter the repo or CI cache without manifest entries and legal/storage review.

### 8.1.1 Architecture Decision Records To Create

The plan should be converted into explicit ADRs as implementation proceeds. ADRs may live inside this document at first, then move to `docs/adr/` when that becomes easier to maintain.

Required ADR fleet:

- `ADR-001: RapidRaw public fork with local RawEngine parent workspace`
  - Decision: the public project repo is the user's `RapidRaw` fork; `/Users/cgas/Documents/RawEngine` is the local parent workspace; the fork checkout lives under `RapidRaw/`.
  - Validation: repo topology docs, remote policy, no ambiguous root build assumptions.
- `ADR-002: API-first editing engine`
  - Decision: every edit operation is a typed command and edit-graph mutation.
  - Validation: representative edit works through UI, CLI/test harness, and future agent tool.
- `ADR-003: Versioned non-destructive edit graph`
  - Decision: originals are immutable; sidecars store versioned graph operations.
  - Validation: original hash tests, sidecar roundtrip, migration tests.
- `ADR-004: Scene-referred color pipeline`
  - Decision: internal editing defaults to scene-referred processing with explicit display/output transforms.
  - Validation: ColorChecker metrics, CPU/GPU parity, gamut tests, clipping tests.
- `ADR-005: GPU pipeline with CPU/reference validation path`
  - Decision: GPU rendering is primary for interaction; CPU/reference path exists for tests or reduced deterministic checks.
  - Validation: shader compile tests, parity tolerances, golden renders.
- `ADR-006: Graph-native layers and masks`
  - Decision: layers and masks are edit graph nodes, not UI-only overlays.
  - Validation: layer reorder tests, mask composition tests, render determinism.
- `ADR-007: Merge artifacts as editable sources`
  - Decision: HDR, panorama, focus stack, and super-resolution outputs become explicit merge artifacts that enter the normal edit pipeline.
  - Validation: artifact schema tests, provenance tracking, output editability tests.
- `ADR-008: Sidecar plus catalog model`
  - Decision: sidecars are portable source of truth; catalog/index is rebuildable workflow acceleration.
  - Validation: catalog rebuild tests, missing file tests, sidecar import/export tests.
- `ADR-009: Strict schema-generated API and tool registry`
  - Decision: UI, CLI, tests, plugins, and agent use generated schemas from the same command definitions.
  - Validation: schema drift CI, strict JSON Schema tests, tool replay tests.
- `ADR-010: OpenAI app-server agent safety boundary`
  - Decision: agent edits only through typed tools and never through UI automation.
  - Validation: tool-call audit log, prompt injection tests, approval boundary tests.
- `ADR-011: macOS-first release posture`
  - Decision: macOS quality gates are mandatory first; inherited cross-platform support is preserved where practical.
  - Validation: macOS Tauri build, high-DPI UI QA, signing/notarization plan.
- `ADR-012: Plugin and extension isolation`
  - Decision: plugin system waits until core API stabilizes and should prefer isolated/WASM or process boundaries.
  - Validation: permission model, license declaration, failure behavior.

Contract-freeze ADRs to add before major feature implementation:

- `ADR-API-001: Typed command envelope and query envelope`
  - Decision: every mutating edit path uses a versioned command envelope with command ID, target scope, before revision, dry-run flag, provenance, and expected warnings.
  - Validation: command schema drift CI, representative replay smoke, dry-run snapshot, approval-boundary test, and no raw Tauri invoke exposure in app-server tools.
- `ADR-GRAPH-001: Edit graph schema, migration, and replay contract`
  - Decision: graph operations are discriminated, versioned, migratable, and replayable across UI, CLI, tests, and app-server tools.
  - Validation: sidecar roundtrip, migration fixture, graph replay smoke, revision-conflict test, and schema-diff failure on unreviewed changes.
- `ADR-COLOR-001: Working-space, display-transform, and proofing policy`
  - Decision: RawEngine names its internal working space, scene/display boundary, display proofing policy, export profile behavior, and out-of-gamut warning semantics.
  - Validation: ColorChecker metrics, neutral drift, gamut warnings, macOS display-profile smoke, and CPU/GPU parity fixtures.
- `ADR-MAC-001: macOS color management and display proofing`
  - Decision: macOS preview/export behavior explicitly accounts for display profiles, high-DPI rendering, wide-gamut displays, and screenshots used as validation artifacts.
  - Validation: macOS fixture machine metadata, display-profile smoke, screenshot/render artifact policy, and export-profile tests.
- `ADR-GPU-001: WGPU/CPU reference parity`
  - Decision: GPU is the interactive path, CPU/reference renders are the deterministic oracle for selected fixtures, and tolerances are operation-specific.
  - Validation: shader compile, CPU/GPU golden comparison, tolerance manifest, fallback behavior, and precision-regression budget.
- `ADR-COORD-001: Coordinate spaces and overlay mapping`
  - Decision: all crops, masks, brush strokes, gradients, transforms, previews, WGPU overlays, and UI hit tests declare their coordinate space and transform chain.
  - Validation: crop/rotate/zoom overlay smoke, mask alignment fixtures, WGPU overlay parity, and app-server command coordinate roundtrip.
- `ADR-MASK-001: Layer and mask discriminated schemas`
  - Decision: layers, masks, AI masks, ranges, gradients, brushes, and composite operations use discriminated schemas with explicit coordinate and provenance fields.
  - Validation: schema lint, mask composition fixtures, layer reorder replay, AI mask provenance, and geometry invalidation tests.
- `ADR-MASK-002: Mask/layer render order and blend semantics`
  - Decision: layer stack order, blend modes, per-layer adjustments, mask composition, and invalidation are graph-native and deterministic.
  - Validation: blend-mode smoke renders, opacity fixtures, undo/redo replay, export roundtrip, and CPU/GPU parity.
- `ADR-ART-001: Derived artifact provenance and invalidation`
  - Decision: HDR, panorama, focus-stack, super-resolution, generated positives, denoise/enhance outputs, and AI results are first-class derived artifacts.
  - Validation: artifact schema test, source hash/provenance roundtrip, stale-artifact invalidation, editable-source smoke, and no-original-overwrite test.
- `ADR-AI-001: AI provider migration and provenance`
  - Decision: RapidRAW built-in AI features migrate behind typed RawEngine APIs where practical, with provider provenance, fallback semantics, and confidence warnings.
  - Validation: provider fallback test, audit log, warning stability, local/offline behavior, and model/version fixture.
- `ADR-AGENT-001: OpenAI app-server tools, approvals, and replay`
  - Decision: the app-server expert agent uses generated tool schemas from the command/query registry and cannot mutate files without scoped approval and replayable audit.
  - Validation: schema generation, app-server approval tests, prompt-injection fixtures, dry-run/apply replay, cancellation, rollback, and audit-log snapshots.
- `ADR-FIX-001: Fixture manifest, corpus, and legal provenance`
  - Decision: every committed or downloaded validation asset has source, license, hash, intended use, storage class, and privacy/legal metadata.
  - Validation: fixture manifest lint, hash verification, license allowlist, sample download cache policy, and prohibited-asset checks.
- `ADR-VALID-001: Shift-left validation gate naming and ownership`
  - Decision: each high-risk feature family declares named local/CI/nightly gates before implementation.
  - Validation: changed-file-to-gate mapping, PR evidence ledger, required-check mapping, skipped-check rationale, and milestone gate summary.
- `ADR-LIC-001: Legal claims, preset naming, and provenance`
  - Decision: RawEngine avoids overclaiming equivalence to competitors, manufacturer endorsement, exact film-stock emulation, or proprietary profile compatibility.
  - Validation: claim lint, preset registry provenance review, license scan, AGPL compliance review, and banned wording tests.

### 8.2 Non-Destructive Edit Graph

The edit graph is the core contract.

It should model:

- Source image.
- RAW decode parameters.
- Camera profile.
- Working color space.
- Ordered global operations.
- Layers.
- Masks.
- Layer-scoped operations.
- Merge/stack artifacts.
- Output transforms.
- Export recipes.
- History entries.
- Version metadata.
- Graph revision IDs.
- Conflict policy for concurrent UI/API/agent edits.
- Derived assets from computational operations.

Each operation should have:

- Stable operation type.
- Versioned schema.
- Parameters.
- Defaults.
- Valid ranges.
- UI metadata.
- API metadata.
- Serialization tests.
- Migration logic.
- Deterministic render tests.

Edit graph invariants:

- Every graph mutation is a transaction.
- Every transaction has a before revision and after revision.
- Concurrent edits must either merge safely or fail with a clear revision conflict.
- UI, API, CLI, batch jobs, plugins, and agent tools all use the same command envelope.
- Presets are represented as graph command history, graph fragments, or explicit preset nodes, not untracked UI macros.
- Missing inputs make affected nodes invalid but should not corrupt unrelated graph state.
- Derived artifacts keep provenance back to source assets and settings.

Example operation families:

- `raw.decode`
- `profile.camera`
- `tone.exposure`
- `tone.curve`
- `tone.filmic`
- `color.whiteBalance`
- `color.hsl`
- `color.selectiveRange`
- `color.skinUniformity`
- `detail.sharpen`
- `detail.denoise`
- `geometry.crop`
- `geometry.perspective`
- `effect.grain`
- `effect.halation`
- `mask.brush`
- `mask.luminanceRange`
- `mask.aiSubject`
- `layer.adjustment`
- `merge.hdr`
- `merge.panorama`
- `merge.focusStack`
- `merge.superResolution`
- `export.recipe`

### 8.3 Color Pipeline

The color pipeline should be explicit and testable:

1. RAW decode and linearization.
2. Black/white level correction.
3. Demosaic.
4. Camera color transform.
5. Chromatic adaptation.
6. Scene-referred working space.
7. Lens and optical corrections where appropriate.
8. Global and local scene-referred operations.
9. Layer compositing in a defined color space.
10. Display transform.
11. Output color space transform.
12. Quantization/export.

Required design decisions:

- Choose a working scene-referred color space.
- Decide how much of RapidRAW's existing AgX path to retain or evolve.
- Define profile lookup and camera matching strategy.
- Define ICC handling.
- Define perceptual color spaces for UI controls.
- Define gamut mapping.
- Define HDR display roadmap separately from HDR merge.

### 8.4 Public Editing API

Every editing surface should be invokable through an API.

API principles:

- UI calls the same command layer as automation.
- Commands are schema-validated.
- Commands are undoable.
- Commands are idempotent where possible.
- Commands return structured results.
- Commands expose previews and validation errors.
- Destructive operations require explicit confirmation.
- Batch operations are first-class.
- Headless rendering is supported.

Command envelope requirements:

- Command ID.
- Command type.
- Schema version.
- Target asset ID.
- Expected graph revision.
- Parameters.
- Dry-run flag.
- Approval requirement.
- Actor:
  - UI.
  - CLI.
  - batch.
  - plugin.
  - agent.
- Timestamp.
- Correlation ID.
- Idempotency key where applicable.
- Result:
  - success.
  - validation error.
  - revision conflict.
  - approval required.
  - render failed.
  - dependency missing.

Read/write separation:

- Read commands inspect project, image, graph, metadata, previews, histograms, scopes, and artifacts.
- Write commands mutate graph, sidecars, catalog state, derived artifacts, or exports.
- Write commands must be undoable where possible.
- Destructive file commands must support dry-run and approval.
- Agent tools must expose write risk clearly in tool descriptions.

Future API issues:

- `api(commands): define RawEngine command envelope v1`
- `api(commands): define read write and dry-run semantics`
- `api(commands): define graph revision conflict policy`
- `api(commands): define idempotency and correlation IDs`
- `api(commands): generate Rust TypeScript and JSON Schema types`
- `api(commands): add command replay test harness`

API surfaces:

- Local TypeScript API for UI.
- Rust command API through Tauri.
- Local HTTP or IPC API for app-server integration, if needed.
- CLI for validation, batch rendering, and automation.
- OpenAI app-server dynamic tools for agent use.

### 8.4.1 File And Metadata Safety

RawEngine must treat originals as immutable and metadata writes as high-risk operations.

Rules:

- Never modify original RAW files.
- Prefer sidecars for RawEngine-native edit state.
- Treat XMP/IPTC/EXIF writes as explicit operations with confirmation and tests.
- Catalog/cache/previews must be disposable or rebuildable.
- Batch move/copy/rename/delete operations require dry-run output.
- Agent-driven file operations require approval.
- Export overwrite requires explicit policy.
- Sidecar writes should be atomic:
  - write temp file.
  - fsync where practical.
  - rename into place.
  - keep backup or recovery path when migrating.
- Sidecar migrations must be versioned and tested.
- Failed writes must not corrupt the previous valid sidecar.

Safety validation issues:

- `safety(originals): add original hash immutability tests`
- `safety(sidecars): add atomic sidecar write tests`
- `safety(sidecars): add sidecar migration rollback tests`
- `safety(metadata): define XMP IPTC EXIF write policy`
- `safety(batch): add dry-run for move copy rename delete`
- `safety(export): define overwrite and collision policy`
- `safety(agent): require approval for file operations`

### 8.5 OpenAI App-Server Agent

RawEngine should include a full-featured expert editing agent built on the OpenAI Codex app-server.

RapidRAW AI migration requirement:

- Audit every built-in AI feature inherited from RapidRAW.
- Keep useful AI capabilities, but move them behind RawEngine's typed command/API layer.
- Expose AI capabilities through Codex app-server tools where practical.
- Do not leave AI functionality as UI-only actions.
- Preserve local/offline AI paths when useful and legally compatible.
- Keep self-hosted/external AI backends behind explicit provider abstractions.
- Require approval and clear disclosure for cloud AI calls.
- Record model/backend provenance in sidecars or artifact metadata when AI output affects edits.
- Make AI outputs reproducible where possible, or explicitly mark them non-deterministic.
- Add fallback behavior when AI providers are unavailable.
- Add tests for AI tool schemas, approvals, provenance, and replay.

Agent goals:

- Understand photographic editing goals.
- Inspect metadata and rendered previews.
- Suggest edit plans.
- Apply edits through tool calls.
- Compare before/after states.
- Iterate with user feedback.
- Explain changes in professional photo-editing language.
- Never modify originals.
- Ask for confirmation before expensive, destructive, or ambiguous batch operations.

App-server requirements:

- Implement app-server lifecycle:
  - initialize.
  - thread start/resume.
  - turn start/steer.
  - stream updates.
  - completion events.
- Expose dynamic editing tools with strict schemas.
- Use strict function/tool schemas:
  - `additionalProperties: false`.
  - Required fields explicit.
  - Optional values represented safely.
- Namespace tools to avoid collisions with built-ins.
- Log every tool call in an audit trail.
- Make every agent edit replayable through the edit graph.
- Support approvals for:
  - batch changes.
  - export/delete/move operations.
  - external model calls.
  - cloud services.

Initial agent tool groups:

- Project:
  - open project.
  - list images.
  - get selected image.
  - get metadata.
  - set rating/label/tag.
- Preview:
  - render preview.
  - sample pixels.
  - get histogram.
  - get scopes.
  - compare variants.
- Edit graph:
  - list operations.
  - add operation.
  - update operation.
  - remove operation.
  - reorder operation.
  - undo.
  - redo.
  - create virtual copy.
- Tone:
  - set exposure.
  - set contrast.
  - recover highlights.
  - lift shadows.
  - set curve.
  - set filmic/display transform.
- Color:
  - set white balance.
  - adjust HSL.
  - create color range.
  - apply selective color.
  - apply skin tone uniformity.
  - apply color grading.
- Masks:
  - create brush mask.
  - create range mask.
  - create subject/sky/background mask.
  - combine masks.
  - refine mask.
- Layers:
  - create layer.
  - set layer opacity.
  - attach mask.
  - apply layer adjustment.
- Computational:
  - create HDR merge.
  - create panorama.
  - create focus stack.
  - create super-resolution output.
- Export:
  - create recipe.
  - render export.
  - validate export.

AI migration tool groups:

- AI masks:
  - subject mask.
  - sky mask.
  - background mask.
  - foreground mask.
  - depth mask.
  - people/parts masks, later phase.
- AI enhancement:
  - denoise.
  - super-resolution, if model-based.
  - object removal/heal, if implemented.
- AI generation/inpainting:
  - optional and approval-gated.
  - must create graph transactions or derived artifacts.
  - must preserve provenance.
- AI provider management:
  - local model availability.
  - self-hosted backend status.
  - cloud backend status.
  - consent/approval state.

AI migration issues:

- `ai(audit): inventory RapidRAW built-in AI features`
- `ai(api): define provider abstraction for local self-hosted and cloud AI`
- `ai(app-server): expose AI mask tools through Codex app-server`
- `ai(app-server): expose AI enhancement tools through Codex app-server`
- `ai(provenance): record model backend and settings in sidecars`
- `ai(approval): require approval for cloud AI and generative edits`
- `validation(ai): add AI tool schema and replay tests`
- `validation(ai): add unavailable-provider fallback tests`

### 8.6 Plugin And Extension Boundary

Plugins should not be implemented until the edit graph and command API are stable, but the safety boundary should be planned now.

Plugin principles:

- Plugins register commands or graph nodes through a typed manifest.
- Plugins declare permissions.
- Plugins declare license.
- Plugins declare supported RawEngine API versions.
- Plugins cannot mutate originals directly.
- Plugin edit nodes must serialize and fail gracefully when missing.
- Native plugins are high-risk and require explicit approval.
- WASM or isolated-process plugins are preferred.
- Shader/plugin operations must declare color-domain assumptions.
- Plugin failures should not prevent safe startup.
- Safe mode should disable third-party plugins.

Plugin issues:

- `plugin(adr): define capability-based plugin architecture`
- `plugin(manifest): define plugin manifest v1`
- `plugin(api): define operation registration contract`
- `plugin(color): define plugin color-domain contract`
- `plugin(security): define WASM versus native plugin tiers`
- `plugin(security): define signing permissions and safe mode`

## 9. Tooling, Linting, And Bun Plan

Tooling hardening is the first code-changing implementation milestone because it determines how confidently future work can move. It must happen after the no-change RapidRAW baseline snapshot, so RawEngine can distinguish existing upstream failures from regressions introduced by strictness or Bun migration.

### 9.1 TypeScript Strictness

RapidRAW already has `strict` enabled in its current `tsconfig`. RawEngine should harden beyond that where compatible:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`
- `noPropertyAccessFromIndexSignature: true`
- `useUnknownInCatchVariables: true`
- `noFallthroughCasesInSwitch: true`
- `noImplicitReturns: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`, with intentional underscore convention if used
- `allowUnreachableCode: false`
- `allowUnusedLabels: false`
- `forceConsistentCasingInFileNames: true`
- `isolatedModules: true`
- `verbatimModuleSyntax: true`
- `skipLibCheck` should be audited and reduced if practical

If a flag creates too much churn in the first PR, split into follow-up issues. Do not weaken the final target.

Future TypeScript issue split:

- `tooling(tsconfig): audit current TypeScript compiler options`
  - Scope: document current config and failures without changing behavior.
  - Validation: existing typecheck command.
- `validation(types): fix current RapidRAW typecheck failures`
  - Scope: make the current `strict: true` TypeScript baseline pass before
    enabling stricter flags.
  - Validation: `bun run typecheck`.
  - Note: strict flag issues below are blocked by this cleanup because new flags
    are not meaningfully attributable while the baseline already fails.
- `tooling(tsconfig): enable noUncheckedIndexedAccess`
  - Scope: enable one flag, fix resulting project-owned errors.
  - Validation: typecheck plus targeted tests.
- `tooling(tsconfig): enable exactOptionalPropertyTypes`
  - Scope: enable one flag, fix optional-field modeling.
  - Validation: typecheck plus sidecar/schema tests if touched.
- `tooling(tsconfig): enable noImplicitOverride`
  - Scope: add required override annotations.
  - Validation: typecheck.
- `tooling(tsconfig): enforce noPropertyAccessFromIndexSignature`
  - Scope: make dynamic object access explicit.
  - Validation: typecheck.
- `tooling(tsconfig): audit skipLibCheck`
  - Scope: decide whether to keep, narrow, or remove `skipLibCheck`.
  - Validation: typecheck in CI.
- `tooling(types): add generated type drift checks`
  - Scope: ensure generated schemas/types are current.
  - Validation: generation command plus clean git diff.

### 9.2 ESLint Target

Use ESLint flat config and type-aware linting:

- `typescript-eslint` strict type-checked config.
- `typescript-eslint` stylistic type-checked config where useful.
- React rules.
- React Hooks rules.
- React Refresh rules.
- JSX accessibility rules.
- Import/order rules.
- No floating promises.
- No unsafe assignment/call/member access except fenced legacy areas with issues.
- No implicit `any`.
- No unused variables except explicit underscore convention.
- No console in production paths, except approved logging wrappers.
- Exhaustive switch checks where possible.
- Strict boolean expressions where practical.
- Prefer readonly data where practical.
- No unhandled promises.
- No direct DOM escape hatches without comment.
- No warnings in CI:
  - `eslint . --max-warnings 0`

Current enforced status as of June 12, 2026:

- Type-aware parser project service is enabled.
- Strict typed rules are active, including
  `@typescript-eslint/no-confusing-void-expression`,
  `@typescript-eslint/no-unnecessary-condition`,
  `@typescript-eslint/restrict-template-expressions`, and
  `@typescript-eslint/unbound-method`.
- React Hooks `rules-of-hooks`, `exhaustive-deps`, `static-components`,
  `immutability`, `preserve-manual-memoization`, `purity`, `refs`, and
  `set-state-in-effect` are active.
- `bun run check:lint` is expected to pass with zero warnings on main.

Remaining focused ESLint work:

- Accessibility static interaction and keyboard-event parity rules.
- Import ordering, import cycle, and unknown-file boundary enforcement.

Formatting should be handled by Prettier or the project's chosen formatter, not by large ESLint formatting rule churn.

Future ESLint issue split:

- `tooling(eslint): audit current config and warning inventory`
  - Scope: run current lint, classify current warnings/errors, document baseline.
  - Validation: lint output captured in issue/PR.
- `tooling(eslint): adopt type-aware parser project service`
  - Scope: enable type-aware lint infrastructure without broad rule churn.
  - Validation: lint runtime acceptable, CI stable.
- `tooling(eslint): enable strict type-checked rules`
  - Scope: enable strict preset, fix or explicitly fence legacy violations.
  - Validation: `eslint . --max-warnings 0`.
- `tooling(eslint): add React and hooks rules`
  - Scope: enforce component and hooks correctness.
  - Validation: lint plus representative UI tests.
- `tooling(eslint): add accessibility rules`
  - Scope: catch missing labels, roles, keyboard hazards.
  - Validation: lint plus manual UI checklist for changed components.
- `tooling(eslint): add import/order and boundary rules`
  - Scope: prevent architecture drift and circular dependency growth.
  - Validation: lint.
- `tooling(eslint): add no-floating-promises and async safety`
  - Scope: prevent unhandled async failures in UI/API.
  - Validation: lint plus tests around affected async paths.
- `tooling(eslint): fail CI on warnings`
  - Scope: remove `continue-on-error` and enforce `--max-warnings 0`.
  - Validation: required PR check fails on any warning.
- `tooling(eslint): define allowed escape hatches`
  - Scope: document when `eslint-disable` is allowed and require reason comments.
  - Validation: lint rule or grep check for disable comments without reasons.

Target ESLint rule families:

| Rule Family               | Intent                                                                   | Future Gate                            |
| ------------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| Type safety               | prevent unsafe `any`, unsafe calls, unsafe member access, unsafe returns | required PR lint                       |
| Promise safety            | prevent floating promises, missing awaits, swallowed async errors        | required PR lint                       |
| Exhaustiveness            | force switch/union exhaustiveness in edit graph and tool handling        | required for API/core                  |
| React hooks               | catch invalid hooks usage and missing dependencies                       | required frontend lint                 |
| React refresh             | keep Vite/React refresh constraints healthy                              | required frontend lint                 |
| Accessibility             | catch missing labels, roles, keyboard traps, invalid ARIA                | required UI lint                       |
| Imports/boundaries        | prevent cycles and forbidden cross-layer imports                         | required once architecture is mapped   |
| No direct mutation        | protect edit graph immutability and React state predictability           | required for edit graph/UI             |
| No console in production  | route logs through structured logger                                     | required after logger exists           |
| No untranslated user text | preserve i18n direction if inherited from RapidRAW                       | required if i18n remains               |
| No unrestricted disables  | require reason comments for lint disables                                | required immediately after strict lint |

Allowed escape hatch policy:

- Every `eslint-disable` must include a reason.
- Every `@ts-expect-error` must include a reason and should fail if unused.
- `@ts-ignore` should be forbidden unless an issue explicitly approves it.
- Unsafe interop with external libraries should be fenced in adapter modules.
- Generated files should be excluded or linted with generated-file overrides, not ad hoc disables.
- Legacy violations should be tracked by issue and fenced by path only when a same-PR fix is too risky.

### 9.3 Bun Migration

Use Bun where applicable:

- Add `packageManager` field for Bun.
- Add `bun.lock`.
- Replace npm CI install paths with `bun install --frozen-lockfile`.
- Run frontend scripts through `bun run`.
- Use Bun test runner for TS utility tests where compatible.
- Keep Vite/Tauri integration if already working.
- Keep Node only where a tool requires Node specifically.
- Do not change Rust/Tauri behavior just to force Bun.
- CI should use `oven-sh/setup-bun@v2`.

Migration order:

1. Audit current scripts.
2. Add Bun install and lockfile.
3. Run existing scripts through Bun.
4. Fix script compatibility.
5. Update CI.
6. Remove obsolete npm lockfiles only after Bun CI is green.

### 9.4 Hooks

Use a hook system such as Lefthook, Husky, or a lightweight repo script. Pick the tool that best fits the fork after audit.

Required hooks:

- `pre-commit`:
  - fail on `main`.
  - run staged formatting/lint checks.
  - run lightweight type-aware checks where practical.
  - block oversized accidental binary additions unless explicitly allowed.
- `commit-msg`:
  - encourage issue reference.
  - optionally enforce conventional commits after the project chooses a convention.
- `pre-push`:
  - fail when pushing `main`.
  - run broader local validation or point to `bun run check`.

The block-main logic must be simple and reliable:

Pre-commit branch guard:

```sh
branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [ "$branch" = "main" ]; then
  echo "Direct commits on main are blocked. Create a feature branch and open a PR."
  exit 1
fi
```

Pre-push remote ref guard:

```sh
while read local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_ref" = "refs/heads/main" ]; then
    echo "Pushes to main are blocked. Push a feature branch and open a PR."
    exit 1
  fi
done
```

## 10. GitHub Actions Quality Gates

GitHub Actions should be treated as the product's quality firewall.

### 10.1 Required Workflows

#### PR Validation

Runs on pull requests and pushes to protected branches.

Parallel jobs:

- Frontend install/cache.
- Frontend lint.
- Frontend typecheck.
- Frontend tests.
- Frontend build.
- Rust format.
- Rust clippy.
- Rust tests.
- Tauri config validation.
- macOS app build.
- Schema validation.
- Sidecar roundtrip tests.
- Documentation link check.
- License check.
- Dependency audit.
- Secret scan.
- Image fixture smoke tests.

#### Full Build

Runs on PRs that touch build/app code and on `main`.

Parallel jobs:

- macOS Apple Silicon build.
- macOS Intel build if runner/support is practical.
- Linux build if inherited support remains.
- Windows build if inherited support remains.
- Android build if inherited support remains.

For RawEngine's current priority, macOS builds are mandatory. Other platforms can be allowed to fail only if explicitly marked non-blocking and documented.

#### Image Quality Regression

Runs nightly and on demand.

Jobs:

- Render golden corpus.
- Compare image hashes.
- Compute SSIM/PSNR where appropriate.
- Compute color chart DeltaE metrics.
- Compare histograms/scopes.
- Validate mask outputs.
- Validate HDR merge outputs.
- Validate panorama stitching outputs.
- Validate focus stack outputs.
- Validate super-resolution outputs.
- Upload artifacts.

#### Performance Regression

Runs nightly and before release.

Jobs:

- Cold import timing.
- First preview timing.
- Slider interaction latency.
- GPU render timing.
- Export timing.
- Batch export timing.
- Memory usage.
- Large panorama memory behavior.
- HDR merge memory behavior.

#### Release

Runs only from tags or approved release branches.

Jobs:

- Re-run required validation.
- Build signed/notarized macOS app when credentials exist.
- Build release artifacts.
- Generate checksums.
- Generate SBOM.
- Publish GitHub release draft.

### 10.2 Branch Protection Required Checks

Initial required checks:

- `frontend-lint`
- `frontend-typecheck`
- `frontend-test`
- `frontend-build`
- `rust-fmt`
- `rust-clippy`
- `rust-test`
- `tauri-build-macos`
- `schema-validation`
- `sidecar-roundtrip`
- `license-check`
- `dependency-audit`

Later required checks:

- `image-quality-smoke`
- `performance-smoke`
- `agent-tool-schema`
- `app-server-integration`
- `visual-regression`

Stable check-name policy:

- Required checks should use stable kebab-case names.
- Renaming a required check requires a branch protection update issue.
- New checks can run as non-required until stable.
- Required checks must not use `continue-on-error`.
- Required checks must not silently skip because of path filters when workflow files or shared configs change.
- If a required check is temporarily disabled, the disabling PR must include:
  - issue link.
  - reason.
  - restoration condition.
  - risk.
  - owner.

Suggested final required check set:

- `docs-check`
- `frontend-lint`
- `frontend-typecheck`
- `frontend-test`
- `frontend-build`
- `rust-fmt`
- `rust-clippy`
- `rust-test`
- `schema-drift`
- `sidecar-roundtrip`
- `tauri-build-macos`
- `license-audit`
- `dependency-audit`
- `secret-scan`
- `image-quality-smoke`
- `agent-tool-schema`

### 10.3 CI Rules

- No `continue-on-error` for required quality gates.
- Use matrix builds for parallelism.
- Use `fail-fast: false` when it helps collect all failures on PRs.
- Use `max-parallel` only when resource limits require it.
- Cache Bun, Cargo, Tauri, and build artifacts carefully.
- Keep expensive tests split from fast PR checks.
- Upload artifacts for failed visual/image tests.
- Keep CI commands mirrored by local scripts.

### 10.3.1 Local Command Contract

Future CI should call the same named commands developers run locally. Exact implementation may change after the RapidRAW audit, but the command contract should aim for:

| Command                                                                | Purpose                                       | Expected Scope                                      |
| ---------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| `bun run check`                                                        | full local validation mirror for ordinary PRs | lint, typecheck, tests, build smoke where practical |
| `bun run check:quick`                                                  | pre-push fast gate                            | fast lint/type/unit checks only                     |
| `bun run lint`                                                         | frontend lint                                 | ESLint with `--max-warnings 0`                      |
| `bun run typecheck`                                                    | TypeScript typecheck                          | project references if applicable                    |
| `bun run format:check`                                                 | formatting check                              | frontend/docs formatting                            |
| `bun run test`                                                         | frontend/unit tests                           | TS/React utilities and components                   |
| `bun run build`                                                        | frontend build                                | Vite/Tauri frontend build                           |
| `bun run schema:check`                                                 | schema generation drift                       | edit graph/API/tool schemas                         |
| `bun run docs:check`                                                   | docs lint/link check                          | markdown and links                                  |
| `bun run fixtures:check`                                               | fixture manifest validation                   | license/source/hash metadata                        |
| `cargo fmt --all --check`                                              | Rust formatting                               | Rust workspace                                      |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | Rust lint                                     | warnings-as-errors                                  |
| `cargo test --workspace`                                               | Rust tests                                    | Rust workspace                                      |
| `cargo audit` or chosen equivalent                                     | Rust vulnerabilities                          | dependencies                                        |
| `cargo deny` or chosen equivalent                                      | Rust license/security policy                  | dependencies                                        |

If a command cannot exist exactly because of RapidRAW's structure, create the closest equivalent and document the reason in the plan.

### 10.4 CI Topology

The workflow graph should make dependencies explicit.

PR workflow topology:

- `changes`
  - Detect changed paths.
  - Emit booleans for frontend, rust, tauri, docs, workflows, schemas, fixtures, and agent.
- `frontend-install`
  - Depends on `changes`.
  - Runs only when frontend or lockfiles changed.
  - Restores Bun cache.
- `frontend-lint`
  - Depends on `frontend-install`.
  - Required when frontend changed.
- `frontend-typecheck`
  - Depends on `frontend-install`.
  - Required when frontend changed.
- `frontend-test`
  - Depends on `frontend-install`.
  - Required when frontend changed.
- `frontend-build`
  - Depends on `frontend-install`.
  - Required when frontend/app changed.
- `rust-fmt`
  - Depends on `changes`.
  - Required when Rust changed.
- `rust-clippy`
  - Depends on `changes`.
  - Required when Rust changed.
- `rust-test`
  - Depends on `changes`.
  - Required when Rust changed.
- `schema-drift`
  - Required when API/schema/tool definitions changed.
- `docs-links`
  - Required when markdown/docs changed.
- `license-audit`
  - Required when dependencies changed.
- `security-scan`
  - Required for all PRs.
- `tauri-build-macos`
  - Depends on frontend build and Rust checks when app code changed.
  - Required for app-impacting PRs.
- `image-quality-smoke`
  - Required for renderer/image-processing PRs.
  - Uploads rendered artifacts on failure.
- `agent-tool-schema`
  - Required for agent/API tool changes.

Workflow-level rules:

- Do not cancel superseded PR or `main` runs; keep prior CI evidence available.
  Improve speed through parallelism, changed-path routing, caching, and smaller
  validation commands.
- Keep required check names stable so branch protection does not drift.
- Upload failed test artifacts with retention long enough for review.
- Use path filters for cost, but never skip checks when workflow/config changes.
- Nightly workflows should run the expensive full image-quality and performance suite even when PR path filters skip it.
- Release workflows must re-run required checks instead of trusting stale PR results.

## 11. Self-Validation Loops

RawEngine needs validation loops strong enough that autonomous implementation can proceed safely.

### 11.0 Validation Placement Map

Validation should be placed as far left as practical. The same requirement can appear in multiple layers when the feedback loop is cheap enough.

| Validation Layer   | Purpose                                             | Examples                                                                                    | Future Blocking Level                 |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| Editor/IDE         | Catch mistakes while typing                         | TypeScript language service, ESLint in editor, Rust analyzer, format on save                | Developer convenience                 |
| Pre-commit         | Block obvious local mistakes before a commit exists | Main branch guard, staged lint, format check, generated schema drift, forbidden large files | Hard local block                      |
| Commit message     | Keep work traceable                                 | Issue reference, conventional commit if adopted, no vague messages                          | Soft or hard after convention         |
| Pre-push           | Avoid wasting CI                                    | Main ref push guard, fast `check:quick`, no direct `HEAD:main` push                         | Hard local block                      |
| Local full check   | Mirror CI before PR                                 | `bun run check`, Rust checks, Tauri smoke, docs lint                                        | Required PR evidence                  |
| PR fast CI         | Protect review loop                                 | lint, typecheck, unit tests, schema drift, license, security, docs                          | Required branch protection            |
| PR app CI          | Prove buildability                                  | macOS Tauri build, frontend build, Rust integration tests                                   | Required for app-impacting PRs        |
| PR visual/image CI | Catch renderer and UI regressions                   | golden smoke renders, screenshot comparisons, fixture artifacts                             | Required for image/UI PRs             |
| Nightly CI         | Run expensive confidence checks                     | full fixture corpus, performance, large panorama/HDR, agent evals                           | Blocking before release               |
| Release CI         | Prove shippability                                  | signing/notarization, SBOM, full build matrix, release notes                                | Required for release                  |
| Manual QA          | Catch taste and workflow failures                   | color review, UI polish pass, editing workflow checklist                                    | Required for major feature completion |

Shift-left principle:

- If a check is deterministic and fast, put it in pre-commit or PR fast CI.
- If a check is deterministic but slower, put it in local full check and PR app CI.
- If a check is expensive or fixture-heavy, put it in nightly CI and require it before release.
- If a check is subjective, define a human review checklist and attach evidence to the PR.
- If a check protects originals, licenses, branch protection, or schema compatibility, make it a hard gate.

### 11.0.1 Required Validation Categories

Every future issue should declare which categories it touches:

- `validation:types`
- `validation:lint`
- `validation:rust`
- `validation:tauri`
- `validation:build`
- `validation:schema`
- `validation:sidecar`
- `validation:render`
- `validation:gpu-cpu-parity`
- `validation:color`
- `validation:mask`
- `validation:layer`
- `validation:hdr`
- `validation:panorama`
- `validation:focus-stack`
- `validation:super-resolution`
- `validation:film-simulation`
- `validation:metadata`
- `validation:library`
- `validation:export`
- `validation:ui`
- `validation:accessibility`
- `validation:performance`
- `validation:memory`
- `validation:security`
- `validation:license`
- `validation:agent-tools`
- `validation:app-server`
- `validation:docs`

### 11.0.2 Milestone Gate Matrix

Each milestone should define the minimum gates needed before it can be called complete.

| Milestone                                  | Minimum Required Gates                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 0: Maintained Plan Artifact                | markdown render check, link review, plan consistency scan, documentation-only diff                         |
| 0.1: Project Charter And Fork Governance   | branch protection verified, repo visibility verified, issue/PR templates present, AGPL note present        |
| 0.5: RapidRAW Baseline Snapshot            | upstream SHA recorded, existing commands run, failures captured as issues, baseline artifacts saved        |
| 1: Shift-Left Quality Foundation           | Bun install, strict lint/type gates, hooks, Rust checks, license/security checks, zero warning required CI |
| 2: CI Build Matrix And Release Skeleton    | parallel PR jobs, required macOS build, artifact upload, cache behavior, release skeleton dry run          |
| 3: Baseline Audit And Regression Harness   | sidecar roundtrip, history replay, render smoke, fixture manifest, performance smoke                       |
| 4: Versioned Edit Graph And API Foundation | schema validation, migration tests, undo/redo tests, CLI/headless render, API docs                         |
| 5: Color Pipeline Foundation               | ColorChecker fixtures, DeltaE harness, white balance tests, camera profile tests, CPU/GPU parity           |
| 6: Capture One-Class Color Editing         | selective color tests, skin tone fixtures, color mask tests, API command tests, UI artifact                |
| 7: Layers And Masking                      | layer graph tests, mask composition tests, sidecar roundtrip, undo/redo, render artifacts                  |
| 8: Detail Denoise And Wavelet Tools        | high ISO fixtures, edge/detail fixtures, performance budget, artifact review                               |
| 9: Film Simulation Lab                     | legal provenance, LUT import tests, grain/halation fixtures, before/after artifacts                        |
| 10: HDR Merge                              | bracket manifest, alignment/deghost tests, editable merge artifact, memory/time budget                     |
| 11: Panorama Stitching                     | projection fixtures, seam/alignment checks, editable panorama artifact, large-file memory budget           |
| 12: Focus Stacking                         | focus bracket fixtures, sharpness map artifact, blend artifact review, memory/time budget                  |
| 13: Super-Resolution                       | resolution chart fixtures, real-photo crops, hallucination/artifact review, memory/time budget             |
| 14: OpenAI App-Server Agent                | strict tool schemas, replay tests, approval tests, prompt-injection tests, audit logs                      |
| 15: Professional Workflow Polish           | screenshot matrix, accessibility pass, keyboard workflow, batch/export workflow artifacts                  |
| 16: Release Hardening                      | signed/notarized plan, SBOM, checksums, release notes, privacy/security docs                               |

Milestone completion rule:

- A milestone is not complete if any required gate is missing without a linked follow-up issue and explicit deferral rationale.
- A milestone summary should list every merged PR, every skipped validation, every known risk, and every follow-up issue.
- Major feature milestones must include at least one real-world workflow artifact, not only unit tests.

Copyable milestone summary:

```md
## Milestone Completion Summary

Milestone:
Date:
GitHub milestone URL:

## Closed Issues

| Issue | PR  | Validation Evidence | Notes |
| ----- | --- | ------------------- | ----- |
| #     | #   | link/path           |       |

## Required Gates

| Gate      | Result             | Evidence  |
| --------- | ------------------ | --------- |
| gate name | pass/fail/deferred | link/path |

## Artifacts

- CI runs:
- Screenshots:
- Render outputs:
- Fixture manifests:
- Benchmark results:
- Release artifacts:

## Deferred Work

| Follow-up Issue | Reason | Risk |
| --------------- | ------ | ---- |
| #               |        |      |

## Residual Risk

- Risk:
- Mitigation:
- Owner:

## Decision Log Updates

- ADRs added/changed:
- Plan sections updated:
```

### 11.1 Standard Change Loop

For each issue/PR:

1. Read the relevant source and tests.
2. Confirm the exact desired behavior.
3. Make the smallest coherent change.
4. Run local checks matching the PR scope.
5. Add or update tests.
6. For UI or image changes, capture before/after screenshots or rendered outputs.
7. Check git diff before finalizing.
8. Open PR linked to issue.
9. Wait for CI.
10. Fix CI failures.
11. Keep PR scope tight.

### 11.1.1 Validation Evidence Ledger

Every implementation PR should include a validation evidence ledger. The goal is to make the result auditable without asking what was run.

Required fields:

- Local commands run, copied exactly.
- Local command result summary.
- CI run URL.
- Required checks that passed.
- Checks intentionally skipped, with reason.
- Screenshot paths for UI changes.
- Rendered artifact paths for image-processing changes.
- Before/after comparison path when applicable.
- Fixture/source image manifest changes when applicable.
- Known residual risk.
- Follow-up issue links for accepted gaps.

Copyable PR ledger:

```md
## Validation Evidence Ledger

### Local Commands

| Command        | Result            | Notes                   |
| -------------- | ----------------- | ----------------------- |
| `command here` | pass/fail/skipped | reason or artifact path |

### CI

- CI run:
- Required checks passed:
- Required checks failed:
- Checks skipped:
- Skip rationale:

### Artifacts

- UI screenshots:
- Render outputs:
- Before/after comparisons:
- Fixture manifests:
- Logs:

### Safety

- Original file hash check:
- Sidecar roundtrip:
- Schema drift:
- License/dependency impact:
- Security impact:

### Residual Risk

- Known risk:
- Follow-up issue:
```

### 11.2 Image Processing Validation

Maintain a versioned image corpus:

- Public sample RAW files from camera vendors and open test sets.
- ColorChecker shots.
- Skin tone portraits with permissive licenses.
- High dynamic range bracket sets.
- Handheld bracket sets with motion.
- Panorama sequences.
- Multi-row panorama sequences.
- Focus bracket sequences.
- Burst/shifting sequences for super-resolution.
- High ISO noise samples.
- Lens distortion samples.
- Chromatic aberration samples.
- Film negative scans.
- Sky gradients.
- Deep shadows.
- Saturated colors.
- Mixed lighting.

Image source policy:

- Use legally usable internet sample images.
- Prefer public domain, Creative Commons, camera-vendor sample files, and project-owned captures.
- Record source URL, license, camera, lens, and allowed use.
- Use the Chrome plugin when browsing and downloading sample images for local validation, especially when manual verification of source/license/download behavior is needed.
- Capture evidence for downloaded samples: source URL, license text or license page URL, download URL, file hash, and date accessed.
- If Chrome/plugin workflows fail, repair the intended plugin path or ask before using any OS-level browser automation fallback.
- Do not add samples to the repo unless license and size are acceptable.
- Prefer Git LFS or external fixture download scripts for large assets.

Fixture manifest fields:

- Fixture ID.
- File name.
- File type.
- Source URL.
- Download URL.
- License name.
- License URL.
- Date accessed.
- SHA-256 hash.
- File size.
- Camera.
- Lens.
- ISO.
- Shutter speed.
- Aperture.
- Focal length.
- Dimensions.
- Color profile.
- Intended validation use.
- Allowed repository storage:
  - committed.
  - Git LFS.
  - external download.
  - local only.
- Privacy concerns.
- Notes.

Fixture governance issues:

- `validation(fixtures): define fixture manifest schema`
- `validation(fixtures): add fixture license review checklist`
- `validation(fixtures): add fixture hash verification command`
- `validation(fixtures): add external download cache policy`
- `validation(fixtures): add Chrome source-verification workflow`
- `validation(fixtures): decide Git LFS policy`
- `validation(fixtures): add fixture pruning policy`

Validation metrics:

- Sidecar roundtrip equality.
- Render determinism.
- Histogram delta.
- Perceptual hash delta.
- SSIM/PSNR for operations where reference output is stable.
- DeltaE for color chart patches.
- Mask IoU for known masks.
- Alignment error for panorama/HDR/focus stacks.
- Render time budget.
- Peak memory budget.
- GPU/CPU parity tolerance.

Contract-freeze validation gates:

- `validation:command-schema-drift`: generated TypeScript/Rust/JSON schemas match committed command/query definitions.
- `validation:command-replay-smoke`: representative edit, layer, mask, merge, Negative Lab, export, and AI commands dry-run and replay from fixture inputs.
- `validation:graph-migration`: sidecar/edit graph migrations are versioned, fixture-backed, and reversible or explicitly one-way with fallback documentation.
- `validation:fixture-manifest`: fixture entries include source URL, license, hash, intended use, storage class, and privacy/legal notes.
- `validation:legal-claims`: preset/profile/UI/marketing strings avoid banned exact-emulation, endorsement, competitor-compatibility, and proprietary-profile claims.
- `validation:cpu-reference-render`: selected operations produce deterministic CPU/reference artifacts for comparison.
- `validation:gpu-cpu-parity`: WGPU preview/output stays within documented tolerances against reference fixtures.
- `validation:macos-proofing`: macOS display/export proofing behavior is checked with machine/display-profile metadata.
- `validation:overlay-coordinates`: crop, rotate, zoom, mask, gradient, brush, and WGPU overlay coordinates roundtrip through UI and command payloads.
- `validation:mask-composition`: layer/mask blend order, add/subtract/intersect behavior, opacity, and invalidation remain deterministic.
- `validation:derived-artifact-staleness`: HDR, panorama, focus-stack, super-resolution, generated-positive, denoise/enhance, and AI artifacts become stale when sources or settings change.
- `validation:ai-provenance`: provider/model/version/prompt/tool input/source hash/output hash/confidence/fallback fields are present for nondeterministic operations.
- `validation:app-server-tools`: generated app-server tools expose dry-run, approval, audit, replay, cancellation, rollback, and no-original-overwrite behavior.
- `validation:warnings`: image-quality, acquisition, AI confidence, legal/provenance, fixture, and color-management warnings are stable reviewable outputs.

Initial performance budget targets:

These are planning targets, not promises. They should be measured and revised after the RapidRAW baseline snapshot.

| Operation                   | Initial Target                                                           | Gate Type             |
| --------------------------- | ------------------------------------------------------------------------ | --------------------- |
| App cold start              | track baseline, then block regressions over 10 percent without rationale | nightly/performance   |
| Open 24MP RAW first preview | under 2 seconds after baseline feasibility review                        | PR smoke/nightly      |
| Slider preview update       | under 100 ms for preview/ROI path where feasible                         | performance smoke     |
| Brush stroke feedback       | visually continuous at normal brush sizes                                | UI/performance QA     |
| Export 24MP JPEG            | track baseline and regressions                                           | nightly               |
| Export 24MP 16-bit TIFF     | track baseline and regressions                                           | nightly               |
| Import 1,000 RAW folder     | track wall time and memory                                               | nightly               |
| HDR merge 3 x 24MP          | track wall time and peak memory                                          | computational nightly |
| Panorama 6 x 24MP           | track wall time and peak memory                                          | computational nightly |
| Focus stack 10 x 24MP       | track wall time and peak memory                                          | computational nightly |
| Super-resolution 24MP input | track wall time, memory, output dimensions                               | computational nightly |
| Very large panorama stress  | must fail gracefully or complete without crash                           | release gate          |

Performance evidence should include:

- Machine model.
- macOS version.
- CPU/GPU.
- RAM.
- Build mode.
- Input fixture IDs.
- Wall time.
- Peak memory.
- Output dimensions.
- Notes on cache warm/cold state.

### 11.2.1 RAW Editor Image-Quality Gates

Future image-processing PRs should declare one or more gates:

#### Color Gates

- ColorChecker render baseline.
- Median DeltaE trend.
- 95th percentile DeltaE trend.
- Neutral patch drift.
- Skin tone fixture review.
- Saturated color clipping check.
- Out-of-gamut behavior check.
- White balance picker fixture.
- Camera profile lookup fixture.
- Scene-to-display transform fixture.

Required evidence:

- Fixture IDs.
- Render command.
- Before/after outputs.
- Metric table.
- Explanation for expected drift.

#### Layer Gates

- Layer add/delete/reorder replay.
- Layer opacity render comparison.
- Blend mode smoke outputs.
- Per-layer adjustment isolation.
- Layer copy/paste.
- Undo/redo across layer edits.
- Sidecar roundtrip with layers.
- Export with layers enabled/disabled.

Required evidence:

- Edit graph snapshot.
- Render artifact.
- Undo/redo test result.
- Sidecar migration result if schema changed.

#### Mask Gates

- Brush stroke serialization.
- Gradient coordinate behavior after crop/rotate.
- Luminance range mask fixture.
- Color range mask fixture.
- AI mask provenance and model version recording.
- Add/subtract/intersect mask composition.
- Feather/refine output comparison.
- Mask copy/paste across similar images.
- Mask invalidation after geometry change.

Required evidence:

- Mask preview artifact.
- Mask histogram or coverage percentage.
- Known-mask IoU when a reference exists.
- Render output using the mask.

#### HDR Gates

- Bracket detection.
- Exposure normalization.
- Alignment error.
- Deghosting fixture.
- Highlight recovery fixture.
- Moving subject fixture.
- Metadata preservation.
- Editable merge artifact roundtrip.
- Memory and timing budget.

Required evidence:

- Source bracket manifest.
- Merge settings.
- Merged artifact metadata.
- Render output.
- Timing and peak memory.

#### Panorama Gates

- Feature matching smoke.
- Projection mode smoke:
  - spherical.
  - cylindrical.
  - perspective.
  - Panini.
- Multi-row fixture.
- Boundary/crop behavior.
- Exposure/vignetting compensation.
- Seam artifact review.
- Large panorama memory budget.
- Editable panorama artifact roundtrip.

Required evidence:

- Source image manifest.
- Projection/settings.
- Alignment/seam metrics where available.
- Output dimensions.
- Timing and peak memory.

#### Focus Stack Gates

- Alignment fixture.
- Sharpness map fixture.
- Blend artifact fixture.
- Macro/product fixture.
- Retouch path for bad regions.
- Editable focus artifact roundtrip.
- Timing and memory budget.

Required evidence:

- Source focus bracket manifest.
- Sharpness map preview.
- Final render.
- Artifact notes.

#### Super-Resolution Gates

- Resolution chart fixture.
- Real photo fixture.
- Single-image mode, if implemented.
- Multi-image alignment mode.
- Conservative/professional mode with no hallucinated detail.
- Edge artifact review.
- Texture preservation review.
- Timing and memory budget.

Required evidence:

- Scale factor.
- Source manifest.
- Output dimensions.
- Crop comparisons at 100 percent and 200 percent.
- Artifact notes.

#### Film Simulation Gates

- LUT/HaldCLUT import validation.
- Built-in look legal provenance.
- Tone curve fixture.
- Skin tone fixture.
- Over/under-exposure fixture.
- Grain behavior fixture.
- Halation threshold fixture.
- Black-and-white conversion fixture.
- Negative conversion fixture.

Required evidence:

- Look ID/version.
- Source license/provenance.
- Before/after renders.
- Parameter snapshot.
- Legal status for bundled assets.

### 11.3 UI Validation

For UI changes:

- Use screenshots at desktop and laptop-sized viewports.
- Check text overflow.
- Check keyboard navigation.
- Check focus states.
- Check hover/disabled/loading states.
- Check dark and light modes if both exist.
- Check high-DPI rendering.
- Check panel resizing.
- Check drag/drop surfaces.
- Check tooltips for icon buttons.
- Use image generation skill when new visual assets, film-look thumbnails, hero-quality mock imagery, icons not covered by the existing system, or illustrative UI test material is needed.
- Use consult skill for new UI architecture, high-risk workflow design, or design decisions where a second model can expose tradeoffs.
- Store UI validation evidence as PR artifacts or attached screenshots with viewport, OS, and build information.

### 11.4 Agent Validation

Agent changes require:

- Tool schema tests.
- Strict schema validation.
- Tool call replay tests.
- Approval boundary tests.
- No-original-modification tests.
- Undo/redo after agent edit.
- Batch operation dry-run tests.
- Prompt injection tests for metadata and filenames.
- Tool audit log snapshot.
- Before/after image artifact.

Agent shift-left gates:

- `agent:schema`
  - Every tool has generated TypeScript type, JSON Schema, Rust-side command mapping if applicable, and docs.
  - Strict schema mode: no unbounded arbitrary objects unless explicitly justified.
  - Tool names are namespaced and stable.
- `agent:dry-run`
  - Every mutating tool supports dry-run or preview where practical.
  - Batch edits produce an operation plan before apply.
- `agent:approval`
  - Delete, overwrite, move, export, cloud, external model, and batch operations require explicit approval policy.
  - Approval bypass requires a test fixture proving it is impossible or intentional.
- `agent:immutability`
  - Original files are never modified.
  - Agent edits create graph transactions, sidecars, virtual copies, or derived artifacts.
- `agent:replay`
  - Tool call logs can replay a representative edit.
  - Replay uses the same edit graph commands as UI and CLI.
- `agent:prompt-injection`
  - Malicious filenames, metadata, sidecar text, and image-embedded text cannot cause destructive tool calls.
  - Tool descriptions remind the model not to trust untrusted metadata as instructions.
- `agent:visual-proof`
  - Any edit claim includes before/after preview artifacts.
  - Agent cannot claim an edit is complete if render/export failed.

Agent issue split:

- `agent(schema): define tool naming and schema policy`
- `agent(schema): generate tool schemas from edit command definitions`
- `agent(audit): add tool-call audit log format`
- `agent(approval): define approval policy for mutating tools`
- `agent(eval): add prompt injection fixtures`
- `agent(eval): add replay tests for representative edits`
- `agent(eval): add before-after artifact requirement`
- `agent(app-server): add lifecycle integration design`
- `agent(app-server): add dynamic tools adapter`
- `agent(app-server): add cancellation and error propagation policy`

### 11.5 Consult Usage Policy

Use the consult skill for:

- Product architecture decisions with long-term consequences.
- New UI feature design where workflow tradeoffs matter.
- Color science changes.
- Deblur/lens deconvolution math.
- Denoise, AI denoise, and noise metric strategy.
- Sharpening/detail math.
- Scene-referred/display-referred pipeline changes.
- Camera profile strategy.
- Film simulation design.
- Panorama stitching implementation strategy.
- HDR merge implementation strategy.
- Focus stacking implementation strategy.
- Super-resolution stitching/stacking strategy.
- Agent tool design and app-server architecture.
- Risky refactors where a second design pass is useful.

Do not use consult as a substitute for reading the code, running tests, or validating real output. Treat it as a second design review.

Science/math-heavy image features must improve through repeatable iterations:

- Consult on the math, validation strategy, and rejected alternatives before
  implementation when the work affects deblur, denoise, sharpening/detail,
  color science, HDR/fusion, panorama/focus/super-resolution reconstruction, or
  negative processing.
- Convert consult advice into executable evidence: Zod-backed fixtures,
  deterministic public metrics, private real-image ledgers when assets cannot
  ship, preview/export parity checks, and runtime apply proof.
- Do not close runtime quality issues from plan-only, dry-run-only,
  schema-only, or fixture-only work. Label the runtime status explicitly until
  the feature can process representative images end to end.
- Tighten thresholds over multiple PRs as the implementation matures, preserving
  accepted/rejected consult advice and validation commands in the plan, issue,
  or PR.

### 11.6 Consult Tracking

Consultations should be tracked when they affect the plan.

Current planning consults:

- Advanced image-science iteration roadmap:
  - Status: completed and incorporated.
  - Response checked time: 2026-06-14.
  - Doc: `docs/detail/image-science-iteration-consult-2026-06-14.md`.
  - Incorporated advice:
    - Rank science work as color correctness first, noise model second,
      detail/sharpening separation third, AI denoise fourth, and deblur/lens
      deconvolution last.
    - Require contract, deterministic fixtures, runtime implementation,
      preview/export parity, real-image proof, and threshold tightening before
      maturity claims.
    - Use explicit runtime-status labels so plan-only, schema-only,
      dry-run-only, synthetic-only, and real-image-proven work cannot be mixed.
    - Keep app-server image-science tools typed, auditable, dry-run capable,
      approval-aware, and routed through the same command layer as the UI.
- Initial RawEngine product plan consult:
  - Status: completed.
  - Incorporated advice:
    - Treat this document as PRD, ADR index, backlog, and validation contract.
    - Make the typed edit API the central invariant.
    - Add source verification log.
    - Add autonomy contract.
    - Add validation evidence requirements.
    - Add no-change RapidRAW baseline before code-changing strictness work.
- RawEngine validation/architecture follow-up consult:
  - Status: completed and incorporated.
  - Reminder: temporary Codex thread heartbeat `check-rawengine-consult-outputs` was created while the response was running and deleted after the response was incorporated.
  - Incorporated advice:
    - Treat RapidRAW as the fork base, not the final architecture contract.
    - RawEngine owns graph determinism, sidecar migration, render parity, color, safety, APIs, and licensing.
    - Add graph revision/conflict policy.
    - Add derived asset/artifact model for computational photography outputs.
    - Add command envelope, read/write separation, dry-run, approval, and idempotency planning.
    - Add plugin capability/signing/safe-mode planning.
    - Add macOS signing, notarization, hardened runtime, entitlements, security-scoped bookmark, Gatekeeper, and update rollback planning.
- Negative Lab requirements refinement consult:
  - Status: completed and incorporated.
  - Response checked time: 2026-06-10.
  - Incorporated advice:
    - Make acquisition quality observable before conversion through scan setup checks and warning states.
    - Separate acquisition calibration, objective inversion, roll normalization, creative rendering, and output into explicit workflow stages.
    - Add objective, semi-objective, and creative command classification so presets and batch operations cannot silently mix scientific and creative controls.
    - Add pipeline placement, open color management, display profile, synthetic fixture, numeric gate, and app-server safety ADRs.
    - Strengthen film stock preset governance with confidence tiers, provenance, legal naming, refresh cadence, and prohibited claim checks.
    - Add synthetic negative generation, numeric gates, prohibited asset/claim lint, UI artifacts, and macOS performance validation.
    - Expand app-server agent safety around dry-run, low-confidence approval, file scope, cancellation, warning severity, and no-overwrite output.
- Negative Lab full-lab refinement:
  - Status: completed and incorporated.
  - Response checked time: 2026-06-10.
  - Incorporated advice:
    - Reaffirm Negative Lab as its own first-class professional workspace, not a film-simulation subpanel.
    - Add measured named-stock profile methodology, legal claim boundaries, user/community profile separation, and prohibited UI/marketing claims.
    - Add fixture manifest requirements for real scans, synthetic fixtures, calibration targets, profile data, and golden artifacts.
    - Add numeric, perceptual, warning-stability, UI workflow, batch, agent, and macOS performance gates.
    - Add ADR and issue splits for stock-profile methodology, profile provenance, calibration fixtures, DeltaE/gray-ramp/ColorChecker gates, and full lab workflow regression tests.
- Negative Lab acquisition, profile, and registry gap review:
  - Status: completed and incorporated.
  - Response checked time: 2026-06-10.
  - Incorporated advice:
    - Add a durable acquisition contract so scan/camera/light-source assumptions live in roll/session state and command responses.
    - Add explicit failure-mode taxonomy for no visible base, clipped orange mask, lab JPEGs, scanner auto correction, mixed process, dense/thin negatives, expired film, redscale, and contaminated samples.
    - Separate AcquisitionProfile, ProcessProfile, and StockProfile so scanner/camera correction cannot be hidden inside stock presets.
    - Add edit-graph placement requirements, negative math invariants, intermediate debug artifacts, and a clean audit boundary for inherited upstream negative-conversion logic.
    - Expand the dedicated workspace with roll cockpit, frame health grid, expert densitometer, base sampling studio, roll matching console, profile comparison matrix, synchronized viewer modes, QC statuses, agent activity panel, and WGPU overlay alignment acceptance criteria.
    - Convert "presets for all major film stocks" into a stock-aware registry with coverage tiers, claim levels, source citations, review dates, safe generic profile mappings, and no exact-emulation overclaims.
    - Strengthen validation with public/private fixture storage lint, profile scope lint, warning stability gates, overlay alignment tests, app-server safety tests, and atomic output failure checks.
- Contract-freeze roadmap refinement consult:
  - Status: completed and incorporated.
  - Response checked time: 2026-06-10.
  - Project/data-source note: run from the RapidRaw ChatGPT project with Extended Pro. The ChatGPT UI exposed the GitHub app and `cgasgarth/RapidRaw` as active in the GitHub menu; the composer chip remained generically labeled `GitHub`.
  - Incorporated advice:
    - Add a contract-freeze milestone before major layer, mask, color, Negative Lab, computational photography, AI migration, and app-server work.
    - Treat the current broad `jsAdjustments` style payload seam as a migration target that must be wrapped behind a typed command envelope before agent/layer work depends on it.
    - Require discriminated schemas for future masks, layers, AI masks, derived artifacts, command envelopes, fixture manifests, and app-server tools.
    - Add explicit ADRs for command envelope, edit graph, color/display policy, macOS proofing, GPU/CPU parity, coordinates, masks/layers, derived artifacts, AI provenance, app-server approvals, fixtures, validation gate ownership, and legal claims.
    - Add PRD rules that there are no UI-only edit paths, no implicit display assumptions, no raw app-server Tauri invokes, no schema changes without migration policy, warning outputs are test artifacts, and high-risk issues name their ADR and gate.
    - Add named gates for command schema drift, graph migration, fixture manifest/license lint, replay smoke, CPU reference render, GPU/CPU parity, overlay coordinates, mask composition, derived artifact staleness, AI provenance, app-server tools, warning stability, and legal claim lint.
    - Add issue slices that start with read-only seam audits, ADRs, schema stubs, replay harnesses, fixture lint, CPU reference smoke, changed-file validation mapping, and follow-up issue creation before feature implementation.
- Downstream schema/bridge/app-server validation consult:
  - Status: completed and incorporated.
  - Response checked time: 2026-06-10.
  - Project/data-source note: run from the RapidRaw ChatGPT project with Extended Pro. The GitHub app and `cgasgarth/RapidRaw` repo were visible in the selector; the composer showed a generic GitHub chip and the completed answer showed `Sources: GitHub`.
  - Incorporated advice:
    - Build contract-first command graph architecture before major feature work while allowing existing RapidRAW adjustments to remain behind a migration facade.
    - Add `packages/rawengine-schema/` as the Zod, JSON Schema, TypeScript type, OpenAI tool schema, sample payload, and manifest-hash source of truth.
    - Add `src-tauri/src/edit_core/` as pure Rust graph/command core and `src-tauri/src/bridge/` as a Tauri adapter with typed validation, task lifecycle, progress, cancellation, and artifact handles.
    - Use Zod as the TypeScript-facing contract source and Rust serde structs with `deny_unknown_fields` plus sample contract tests; do not allow independent Rust and TypeScript schema sources.
    - Add policy that new editing bridges avoid `Result<T, String>`, avoid large base64 result payloads, and return typed bridge results/errors and artifact/cache handles.
    - Require mutating commands to carry expected graph revision, actor metadata, approval metadata, dry-run/preview options, typed results/errors, and provenance.
    - Dual-write legacy adjustments plus `rawengineGraph` until sidecar migration policy and tests exist.
    - Treat HDR, panorama, focus-stack, super-resolution, generated positives, denoise/enhance outputs, and AI outputs as graph artifact nodes with provenance and invalidation.
    - Start validation with synthetic fixtures, and add real RAW fixtures only after license/hash/provenance policy lands.
    - Add downstream validation architecture, contract validation commands, edit architecture PR split rule, app-server tool schema policy, and fixture/golden image policy to this plan.

Future consult tracking entry format:

- Topic.
- Prompt purpose.
- Status.
- Response checked time.
- Advice incorporated.
- Advice rejected with reason.
- Follow-up issues created.

## 12. GitHub Milestone Plan

Milestones and issues are planned in this document now. They should be created in GitHub later, after the public repo exists and before feature implementation starts. Each issue should be scoped so one PR can normally close it.

### 12.1 Issue Fleet Conventions

All future GitHub issues should use stable, searchable titles:

```text
area(scope): imperative task
```

Examples:

- `docs(plan): add maintained RawEngine product and technical plan`
- `repo(governance): protect main and require pull requests`
- `tooling(eslint): enable strict type-aware rules`
- `validation(render): add golden render smoke command`
- `api(edit-graph): define versioned edit operation schema`

Recommended labels:

- Area:
  - `area:docs`
  - `area:repo`
  - `area:ci`
  - `area:tooling`
  - `area:frontend`
  - `area:rust`
  - `area:tauri`
  - `area:render`
  - `area:color`
  - `area:layers`
  - `area:masks`
  - `area:library`
  - `area:metadata`
  - `area:export`
  - `area:computational-photo`
  - `area:agent`
  - `area:release`
- Type:
  - `type:plan`
  - `type:adr`
  - `type:implementation`
  - `type:test`
  - `type:ci`
  - `type:refactor`
  - `type:research`
  - `type:docs`
  - `type:security`
- Priority:
  - `priority:p0`
  - `priority:p1`
  - `priority:p2`
  - `priority:p3`
- Risk:
  - `risk:low`
  - `risk:medium`
  - `risk:high`
  - `risk:critical`
- PR size:
  - `pr:size-small`
  - `pr:size-medium`
  - `pr:split-required`
- Validation:
  - Use the `validation:*` labels from the validation category list.
- Status:
  - `status:blocked`
  - `status:ready`
  - `status:needs-design`
  - `status:needs-validation`

Issue dependency syntax:

- Each issue should include `Blocked by:` and `Blocks:` fields.
- If no dependency exists, write `Blocked by: none`.
- If an issue is research-only, it must produce one of:
  - an ADR,
  - a follow-up implementation issue list,
  - a decision to close with no action.

### 12.2 Roadmap Issue Index

This index is the seed list for future GitHub issue creation. Detailed issue bodies should follow the template in Section 13.

#### Milestone 0: Maintained Plan Artifact

- `docs(plan): add maintained RawEngine product and technical plan`
- `docs(readme): point contributors to the RawEngine plan`
- `docs(process): add plan maintenance rule`

#### Milestone 0.1: Project Charter And Fork Governance

- `repo(github): use public RapidRaw fork as project repository`
- `repo(fork): create public RapidRAW fork for nested checkout`
- `repo(topology): document origin/upstream remote policy`
- `repo(governance): protect main and require pull requests`
- `repo(templates): add issue templates`
- `repo(templates): add PR template with validation evidence ledger`
- `repo(labels): create labels for area type priority risk validation and PR size`
- `repo(security): add security policy`
- `repo(license): add AGPL compliance note for RapidRAW fork`

#### Milestone 0.5: RapidRAW Baseline Snapshot

- `baseline(upstream): record RapidRAW upstream commit and dependency state`
- `baseline(build): run existing RapidRAW install lint test and build commands`
- `baseline(ci): create minimal CI mirror of existing upstream commands`
- `baseline(render): capture representative baseline screenshots and render outputs`
- `baseline(debt): create issues for upstream baseline failures`

#### Milestone 1: Shift-Left Quality Foundation

- `tooling(scripts): audit RapidRAW package scripts and CI entrypoints`
- `tooling(bun): add Bun package manager support`
- `tooling(bun): migrate frontend CI install and script execution to Bun`
- `tooling(tsconfig): audit current TypeScript compiler options`
- `tooling(tsconfig): enable noUncheckedIndexedAccess`
- `tooling(tsconfig): enable exactOptionalPropertyTypes`
- `tooling(tsconfig): enable noImplicitOverride`
- `tooling(tsconfig): enforce noPropertyAccessFromIndexSignature`
- `tooling(tsconfig): enable control-flow safety flags`
  - Issue: #1298
  - Docs: `docs/tooling/ts-control-flow-flags-2026-06-15.md`
  - Validation: `bun run check:types`, `bun run schema:types`
  - Status: compiler hardening only; no runtime product behavior change.
- `tooling(types): add generated type drift checks`
- `tooling(types): add script type coverage baseline guard`
  - Issue: #1295
  - Docs: `docs/tooling/script-type-coverage-2026-06-15.md`
  - Validation: `bun run check:script-type-coverage`
  - Status: baseline guard only; full script `@ts-check`/TypeScript migration remains follow-up.
- `tooling(eslint): audit current config and warning inventory`
- `tooling(eslint): adopt type-aware parser project service`
- `tooling(eslint): enable strict type-checked rules`
- `tooling(eslint): add React and hooks rules`
- `tooling(eslint): add accessibility rules`
- `tooling(eslint): add import and boundary rules`
- `tooling(eslint): add async safety rules`
- `tooling(eslint): fail CI on warnings`
- `tooling(eslint): promote unused vars to error`
  - Issue: #1288
  - Docs: `docs/validation/unused-vars-error-2026-06-15.md`
  - Validation: `bun run check:lint`, `bun run check:types`
  - Status: rule severity hardening only; no runtime product behavior change.
- `tooling(eslint): make default lint zero-warning`
  - Issue: #1302
  - Docs: `docs/tooling/lint-zero-warning-default-2026-06-15.md`
  - Validation: `bun run lint`, `bun run check:lint`
  - Status: local command parity with PR lint only; no runtime product behavior change.
- `tooling(casts): make unsafe-cast ban AST-backed`
  - Issue: #1299
  - Docs: `docs/tooling/unsafe-cast-ast-guard-2026-06-15.md`
  - Validation: `bun scripts/check-unsafe-casts.ts --self-test`, `bun run check:unsafe-casts`
  - Status: guard hardening only; no runtime product behavior change.
- `tooling(eslint): define allowed escape hatches`
- `tooling(check): add local check scripts mirroring CI`
- `tooling(hooks): add pre-commit main guard`
- `tooling(hooks): add pre-push main ref guard`
- `tooling(hooks): add staged lint and format checks`
- `ci(quality): remove continue-on-error from required checks`
- `ci(rust): enforce rustfmt clippy warnings-as-errors and tests`
- `ci(security): add dependency vulnerability checks`
- `ci(license): add dependency license checks`
- `deps(audit): report latest major and minor package and crate versions`
- `deps(minor): update JavaScript packages to latest stable compatible releases`
- `deps(minor): update Rust crates to latest stable compatible releases`
- `deps(major): create one migration issue per discovered major package upgrade`
- `ci(docs): add markdown and link checks`

#### Milestone 2: CI Build Matrix And Release Skeleton

- `ci(topology): split validation full-build image-quality performance and release workflows`
- `ci(paths): add path filters without skipping workflow changes`
- `ci(concurrency): document non-cancelling validation run policy`
- `ci(cache): add Bun Cargo Tauri and build caches`
- `ci(macos): add required macOS app build`
- `ci(matrix): add optional inherited platform build matrix`
- `ci(artifacts): upload build and failure artifacts`
- `ci(release): add unsigned release artifact workflow`
- `ci(release): add SBOM and checksum generation`
- `ci(release): document signing and notarization placeholders`

#### Milestone 3: Baseline Audit And Regression Harness

- `audit(architecture): document current RapidRAW architecture`
- `audit(pipeline): document current image pipeline`
- `audit(sidecar): document current sidecar format`
- `audit(gpu): document current GPU and shader pipeline`
- `audit(layers): document current layer and mask model`
  - Docs: `docs/baseline/rapidraw-layer-mask-model-audit-2026-06-15.md`
  - Validation: `scripts/check-layer-mask-model-audit.ts`
  - Runtime status: audit only; current mask-container layer model and graph-native gaps are documented.
- `audit(ai): document current AI and generative hooks`
- `validation(sidecar): add sidecar roundtrip tests`
- `validation(history): add edit history replay tests`
  - Docs: `docs/validation/edit-history-replay-2026-06-15.md`
  - Validation: `scripts/check-edit-history-replay.ts`
  - Runtime status: current in-memory editor history push, undo, redo, jump, branch truncation, and 50-entry bound are helper-backed and fixture-validated; graph-native command replay remains future work.
- `validation(render): add baseline render smoke tests`
- `validation(fixtures): add fixture download policy`
- `validation(fixtures): create public fixture manifest`
- `validation(render): add golden render command`
- `validation(render): add image artifact comparison script`
  - Issue: #69
  - Docs: `docs/validation/render-artifact-comparison-2026-06-15.md`
  - Validation: `scripts/check-render-artifact-comparison.ts`
  - Runtime status: synthetic PPM artifact comparison foundation; renderer-produced RAW artifacts remain follow-up work.
- `validation(performance): add performance smoke script`

2026-06-15 command foundation update:

- `api(commands): add edit command bus`
  - Issue: #78
  - Docs: `docs/api/edit-command-bus-2026-06-15.md`
  - Validation: `bun run schema:command-bus`
  - Status: schema-package dispatch foundation only; live UI/store/Tauri routing remains follow-up.
- `api(commands): route representative UI operations through command bus`
  - Issue: #79
  - Docs: `docs/api/mask-refinement-command-ui-routing-2026-06-15.md`
  - Validation: `bun run check:mask-refine-command-ui`
  - Status: mask refinement UI dispatches typed in-process command; schema-package command bus/runtime replay/Tauri routing remain follow-up.

#### Milestone 3.5: Contract Freeze And Validation Contracts

- `audit(seams): document current jsAdjustments command payload seams`
- `audit(ai): document current RapidRAW AI provider and command seams`
- `audit(negative): quarantine current negative conversion behavior behind an explicit legacy boundary`
- `adr(api): define typed command and query envelope`
- `adr(graph): define edit graph schema migration and replay contract`
- `adr(color): define working space display transform and proofing policy`
- `adr(macos): define macOS color-management proofing policy`
- `adr(gpu): define WGPU and CPU reference parity contract`
- `adr(coord): define coordinate spaces and overlay mapping`
- `adr(mask): define layer and mask discriminated schemas`
- `adr(artifact): define derived artifact provenance and invalidation`
- `adr(ai): define AI provider migration and provenance`
- `adr(agent): define app-server tool approval audit and replay boundary`
- `adr(fixtures): define fixture manifest and legal provenance policy`
- `adr(validation): define shift-left validation gate naming and ownership`
- `adr(legal): define legal claims preset naming and provenance policy`
- `api(schema): add command schema generation spike`
- `api(commands): add command envelope type stubs`
- `validation(commands): add read-only command replay smoke harness`
- `validation(fixtures): add fixture manifest schema lint`
- `validation(reference): add CPU reference render smoke fixture`
- `validation(paths): add changed-file to validation-gate mapping`
- `validation(agent): add app-server tool schema drift placeholder`
- `issues(contract-freeze): create follow-up issues for every high-risk ADR`
- `docs(adr): add downstream validation architecture ADR index`
- `ci(pr): add PR quality workflow skeleton`
- `api(schema): define command envelope and bridge error v1`
- `api(graph): define edit graph skeleton and legacy adjustment node`
- `rust(schema): add serde mirror and contract sample tests`
- `bridge(errors): add typed BridgeResult and RawEngineError adapter`
- `api(commands): add in-memory command bus with no-op and scalar edit`
- `api(cli): add headless validate and replay command`
- `validation(render): add synthetic golden harness`

#### Milestone 4: Versioned Edit Graph And API Foundation

- `api(edit-graph): define versioned edit operation schema`
- `api(layers): define layer schema`
- `api(masks): define mask schema`
- `api(merge): define merge artifact schema`
- `api(export): define export recipe schema`
- `api(schema): add schema validation`
  - Issue: #76
  - Docs: `docs/api/tauri-schema-validation-2026-06-15.md`
  - Validation: `bun run check:tauri-schema-validation`
  - Status: first representative Tauri bridge response parses `get_folder_children` through Zod from `unknown`; full bridge/schema parity remains follow-up work.
- `api(schema): add schema migration mechanism`
- `api(commands): add edit command bus`
- `api(commands): route representative UI operations through command bus`
- `api(history): add undo redo command tests`
  - Validation: `scripts/check-edit-graph-history-commands.ts`
- `api(cli): add headless render command`
- `docs(api): document edit command API`

#### Milestone 5: Color Pipeline Foundation

- `color(audit): audit current RapidRAW color pipeline`
  - Audit: `docs/color/current-color-pipeline-audit-2026-06-15.md`
  - Validation: `scripts/check-color-pipeline-audit.ts`
  - Runtime status: audit/doc guard only; no pixel-path changes.
- `color(adr): decide working color space`
  - ADR: `docs/color/working-color-space-adr-2026-06-14.md`
- `color(adr): decide scene-to-display transform strategy`
  - ADR: `docs/color/scene-to-display-transform-adr-2026-06-14.md`
- `color(adr): decide camera profile strategy`
  - ADR: `docs/color/camera-profile-strategy-adr-2026-06-14.md`
- `color(docs): add color pipeline design doc`
  - Design: `docs/color/color-pipeline-design-2026-06-14.md`
- `validation(color): add ColorChecker fixture set`
  - Manifest: `fixtures/color/colorchecker-fixture-manifest.json`
  - Docs: `docs/color/colorchecker-fixtures-2026-06-14.md`
- `validation(color): add DeltaE measurement harness`
  - Fixtures: `fixtures/color/deltae-reference-fixtures.json`
  - Docs: `docs/color/deltae-harness-2026-06-14.md`
- `validation(color): add histogram and scope validation`
- `validation(color): add CPU GPU parity checks for core color operations`
  - Fixtures: `fixtures/color/cpu-gpu-parity-fixtures.json`
  - Docs: `docs/color/color-cpu-gpu-parity-2026-06-14.md`
  - Runtime status: WGSL contract CPU mirror; live GPU readback remains future work.
- `color(wb): add white balance picker tests`
  - Validation doc: `docs/color/white-balance-picker-validation-2026-06-14.md`
- `color(profile): add camera profile lookup tests`
- `color(cat): add chromatic adaptation plan`
- `color(gamut): add gamut mapping plan`
  - Design: `docs/color/gamut-mapping-plan-2026-06-15.md`
  - Fixtures: `fixtures/color/gamut-mapping-fixtures.json`
  - Validation: `scripts/check-gamut-mapping-fixtures.ts`
  - Runtime status: schema/fixture contract only; preview/export pixel mapping remains future work.

#### Milestone 6: Capture One-Class Color Editing

- `color(selective): add advanced selective color ranges`
  - Contract: `src/utils/selectiveColorRanges.ts`
  - Fixtures: `fixtures/color/selective-color-ranges.json`
  - Docs: `docs/color/selective-color-ranges-2026-06-14.md`
  - Runtime status: UI range metadata is shared and validated against WGSL; interactive range-width editing remains future work.
- `color(selective): add range smoothness and falloff controls`
  - Contract: `src/utils/selectiveColorFalloff.ts`
  - Fixtures: `fixtures/color/selective-color-falloff-fixtures.json`
  - Docs: `docs/color/selective-color-falloff-2026-06-14.md`
  - Runtime status: default falloff math is available and validated; user-adjustable smoothness UI remains future work.
- `color(selective): implement first selective color command`
  - Issue: #2329
  - Bridge: `src/utils/selectiveColorCommandBridge.ts`
  - Runtime: `packages/rawengine-schema/src/localAppServerBridge.ts`
  - Validation: `tests/integration/checks/check-selective-color-command-proof.ts`
  - Runtime status: orange selective color is command-buildable, local app-server dry-run/apply capable, and sidecar-proofed with synthetic preview/export parity; real RAW renderer/UI E2E remains tracked separately.
- `color(skin): add skin tone uniformity controls`
  - Contract: `src/utils/skinToneUniformity.ts`
  - Fixtures: `fixtures/color/skin-tone-uniformity-fixtures.json`
  - Docs: `docs/color/skin-tone-uniformity-2026-06-14.md`
  - Runtime status: uniformity math is available and fixture-backed; full UI and renderer integration remain future work.
- `color(mask): create color masks from selected ranges`
  - Contract: `src/utils/selectiveColorMask.ts`
  - Fixtures: `fixtures/color/selective-color-mask-fixtures.json`
  - Docs: `docs/color/selective-color-mask-contract-2026-06-14.md`
  - Runtime status: selected-range to color-mask conversion is fixture-backed; full UI command wiring remains future work.
- `color(grading): refine color grading wheels`
- `color(balance-rgb): add color balance RGB style module`
- `color(channel-mixer): add channel mixer`
- `color(bw): add black and white mixer`
- `color(profile): add profile and tone curve controls`
- `color(presets): add saved color style presets`
- `color(icc): research ICC profile export path`
- `ui(color): polish advanced color tools`

#### Milestone 7: Layers And Masking

- `layers(ux): define final layer workflow model`
  - Contract: `docs/layers/layer-workflow-model-2026-06-14.md`
  - Runtime status: plan and contract only; runtime layer application remains future work.
- `ui(layers): add polished layer stack UI`
  - Runtime status: layer stack shell is mounted in the masking panel and backed by current mask containers; graph-native layers and blend/reorder commands remain future work.
- `layers(core): add opacity visibility reorder duplicate delete`
  - Runtime status: mask-backed layer stack operations are typed, fixture-validated, and wired to the layer shell; graph-native edit graph persistence remains future work.
- `layers(core): add per-layer adjustments`
  - Runtime status: per-layer scalar adjustment helpers are typed and fixture-validated for current mask-backed layers; full graph operation schemas remain future work.
- `masks(brush): improve brush and eraser masks`
  - Runtime status: brush and eraser parameter schemas, normalization helpers, and fixture validation are present; canvas stroke capture remains future work.
- `masks(gradient): add linear and radial gradients`
  - Runtime status: linear and radial gradient parameter schemas, normalization helpers, and fixture validation are present; canvas handles remain future work.
- `masks(range): add luminance range masks`
  - Runtime status: luminance range schemas, normalization, weight evaluation, and fixture validation are present; renderer integration remains future work.
- `masks(range): add color range masks`
  - Runtime status: color range schemas, selective color range parameter conversion, hue/luma/saturation weight evaluation, and fixture validation are present; renderer integration remains future work.
- `masks(compose): add add subtract intersect`
  - Runtime status: add/subtract/intersect weight composition is typed, clamped, and fixture-validated; renderer integration remains future work.
- `masks(refine): add feather density and edge refine`
  - Docs: `docs/layers/mask-refinement-runtime-2026-06-15.md`
  - Validation: `scripts/check-mask-refinement-parameters.ts`
- 2026-06-15: Added runtime-backed mask refinement controls to the masks panel.
  - Issue: #1245
  - Docs: `docs/layers/mask-refinement-controls-2026-06-15.md`
  - Validation: `scripts/check-mask-refinement-controls.ts`
  - Status: UI-to-runtime plumbing; real-image quality tuning remains a follow-up.
- 2026-06-15: Added typed mask refinement command schema and sample payload.
  - Issue: #1258
  - Docs: `docs/api/mask-refinement-command-2026-06-15.md`
  - Validation: `bun run schema:check`
  - Status: schema/sample command surface; live UI command-bus routing remains a follow-up.
  - Runtime status: feather, density, edge shift, smoothness, and edge contrast schemas plus refined weight evaluation are fixture-validated and wired into the Rust mask renderer; user-facing controls remain future work.
- `masks(overlay): add mask overlay modes`
  - Docs: `docs/layers/mask-overlay-runtime-2026-06-15.md`
  - Validation: `scripts/check-mask-overlay-modes.ts`
  - Runtime status: rubylith, green, blue, white, black, grayscale, inverse, edge, and hidden overlay modes are schema-backed, fixture-validated for preview color evaluation, and wired into the live `generate_mask_overlay` command; user-facing UI controls remain future work.
- `masks(copy): add mask copy paste`
  - Docs: `docs/layers/mask-copy-paste-runtime-2026-06-15.md`
  - Validation: `scripts/check-mask-copy-paste.ts`
  - Runtime status: masks panel context menus expose copy/paste/paste-adjustments and helper fixtures validate clone, insert, invert, rename, and reset-adjustment behavior; typed command/API routing remains future work.
- `masks(ai): audit subject sky background masks`
  - Docs: `docs/layers/ai-mask-capability-audit-2026-06-15.md`
  - Validation: `scripts/check-ai-mask-capabilities.ts`
  - Runtime status: subject, sky, foreground, depth, and derived background capability coverage is schema-backed, fixture-validated, and checked against frontend invoke commands plus Rust command/render branches; runtime quality benchmarking remains future work.
- `masks(ai): research people and parts masks`
  - Consult: 2026-06-14 RapidRaw Pro Extended consultation recommended a staged path: schema contract, deterministic fake provider, render/apply plumbing, dry-run UI, then macOS whole-person runtime before fine portrait parts.
  - Runtime status: people/parts taxonomy, provider tiers, target/artifact schemas, fixture validation, deterministic fake-provider tiny masks, fake people-mask render fixtures, dry-run layer apply plans, and a validated dry-run picker model are present; React UI wiring and runtime whole-person generation remain future work.
- `validation(masks): add mask schema and render tests`

#### Milestone 8: Detail Denoise And Wavelet Tools

- `detail(audit): audit current sharpening and noise tools`
- `detail(sharpen): add capture sharpening`
- `detail(sharpen): add output sharpening`
- `detail(deblur): research deconvolution and lens deblur`
- `detail(local-contrast): refine local contrast`
- `detail(wavelet): design detail-by-scale controls`
- `detail(wavelet): implement detail-by-scale controls`
  - Adds a CPU runtime wavelet detail helper, Zod recipe schema, fixture
    contract, and `bun run check:wavelet-detail` gate.
- `detail(noise): separate chroma and luma noise`
- `validation(noise): add high ISO fixture set`
- `validation(raw): add private real RAW crop evidence ledger`
  - Runtime status: schema-only public ledger and optional local asset check are available; no private RAW payloads are committed.
- `detail(defringe): improve defringe controls`
- `detail(dust): add dust spot visualization`
- `detail(ai-denoise): research AI denoise path`

#### Milestone 9: Film Simulation Lab

- `film(architecture): define film simulation architecture`
- `film(lut): add HaldCLUT import validation`
- `film(looks): add legally safe built-in look collection`
- `film(grain): add film grain model`
- `film(halation): add halation model`
- `film(glow): add bloom and glow model`
- `film(bw): add black and white film controls`
- `film(negative): improve negative conversion`
- `ui(film): add film look browser`
- `ui(film): add side-by-side film comparison`
- `film(presets): add film preset save and share`
- `film(legal): add bundled-look legal review checklist`
- `validation(film): add film simulation fixture outputs`
- `consult(negative-lab): get negative processing lab design review`
- `negative-lab(adr): define negative processing architecture`
- `negative-lab(adr): define density-domain inversion model`
- `negative-lab(adr): define preset naming and legal policy`
- `negative-lab(ui): design dedicated negative lab workspace`
- `negative-lab(ui): add roll setup and frame queue design`
- `negative-lab(ui): add QC overlays and sample readouts design`
- `negative-lab(schema): define negative conversion operation schema`
- `negative-lab(api): expose negative lab command surface`
- `agent(negative-lab): expose safe app-server tools for negative lab`
- `negative-lab(acquisition): add scan setup health model`
- `negative-lab(acquisition): detect auto-corrected and lossy inputs`
- `negative-lab(import): support scan input modes and roll sessions`
- `negative-lab(import): add frame splitting and border detection`
- `negative-lab(format): support half-frame panoramic medium-format and sheet-film scans`
- `negative-lab(calibration): add target and step-wedge workflows`
- `negative-lab(base): add film base sampling controls`
- `negative-lab(inversion): add per-channel inversion curves`
- `negative-lab(contract): classify objective semi-objective and creative operations`
- `negative-lab(color-management): define display and export profile behavior`
- `negative-lab(color): add density normalization and process profiles`
- `negative-lab(bw): add black-and-white process model`
- `negative-lab(ecn2): add remjet and cinema scan assumptions`
- `negative-lab(batch): add roll-level batch consistency workflow`
- `negative-lab(presets): define film stock preset metadata and legal policy`
- `negative-lab(presets): create major film stock registry schema`
- `negative-lab(presets): add stock registry refresh workflow`
- `negative-lab(presets): add preset provenance inspector requirements`
- `negative-lab(presets): add generic legally safe built-in presets`
- `negative-lab(presets): add stock-family research mappings after legal review`
- `negative-lab(presets): add measured-profile fixture format`
- `negative-lab(presets): define named stock measurement methodology`
- `negative-lab(presets): add user and community profile provenance rules`
- `negative-lab(presets): split major stock-family coverage issues`
- `negative-lab(crop): add frame border and crop detection`
- `negative-lab(profiles): add scanner and camera-scan profile inputs`
- `negative-lab(qc): add contact sheet proofing reports`
- `negative-lab(qc): add density and clipping warning reports`
- `negative-lab(output): add positive variant provenance`
- `negative-lab(output): add conversion report and profile roundtrip exports`
- `validation(negative-lab): add negative scan fixture manifest`
- `validation(negative-lab): add fixture licensing and provenance policy`
- `validation(negative-lab): add calibration target fixture manifest`
- `validation(negative-lab): add preset registry lint`
- `validation(negative-lab): add CPU reference conversion fixtures`
- `validation(negative-lab): add synthetic negative generator`
- `validation(negative-lab): add numeric quality gates`
- `validation(negative-lab): add DeltaE gray-ramp and ColorChecker gates`
- `validation(negative-lab): add GPU parity tolerance checks`
- `validation(negative-lab): add prohibited asset and claim lint`
- `validation(negative-lab): add color and black-and-white negative render tests`
- `validation(negative-lab): add roll consistency and QC overlay tests`
- `validation(negative-lab): add full lab UI workflow regression tests`
- `validation(negative-lab): add app-server dry-run and rollback tests`
- `validation(negative-lab): add macOS performance benchmarks`
- `docs(negative-lab): add user guide for negative workflow`

#### Milestone 10: HDR Merge

- `consult(hdr): get HDR architecture review`
  - Advisory review captured in
    `docs/hdr/architecture-consult-summary-2026-06-14.md`. It classifies the
    legacy RapidRAW HDR command path as runtime-capable baseline behavior, not
    the final durable/editable RawEngine artifact architecture.
- `hdr(audit): audit existing RapidRAW HDR merge`
  - Doc: `docs/hdr/existing-hdr-audit-2026-06-14.md`
- `hdr(schema): define HDR merge artifact schema`
  - Schema: `packages/rawengine-schema/src/rawEngineSchemas.ts#hdrMergeArtifactV1Schema`
  - Sample: `packages/rawengine-schema/samples/hdr-merge-artifact-v1.json`
- `hdr(brackets): add bracket detection`
- `hdr(align): add auto alignment tests`
- `hdr(merge): add merge weighting strategy`
- `hdr(deghost): add deghosting strategy`
- `validation(hdr): add HDR fixture set`
  - Issue: #169
  - Fixture manifest: `fixtures/hdr/hdr-synthetic-bracket-fixtures.json`
  - Check: `bun run check:hdr-fixtures`
- `hdr(pipeline): make merged output editable source`
- `ui(hdr): add HDR merge UI`
- `api(hdr): add HDR merge API tools`
- `validation(hdr): add HDR performance tests`

#### Milestone 11: Panorama Stitching

- `consult(panorama): get panorama architecture review`
- `panorama(schema): harden artifact support invariants`
- `panorama(engine): wrap current stitcher behind adapter boundary`
- `panorama(plan): add dry-run memory and geometry preflight`
- `panorama(artifact): persist editable derived panorama sources`
- `panorama(audit): audit existing RapidRAW panorama stitcher`
- `panorama(schema): define panorama artifact schema`
- `panorama(projection): add projection options`
- `panorama(boundary): add auto crop and boundary controls`
- `panorama(exposure): add exposure normalization`
- `panorama(multiraw): audit multi-row support`
- `panorama(tiling): add large panorama tiling strategy`
- `validation(panorama): add panorama fixture set`
- `ui(panorama): add panorama UI`
- `api(panorama): add panorama API tools`
  - Schema samples: `packages/rawengine-schema/samples/computational-merge-panorama-dry-run-app-server-tool-call-validation-v1.json`
    and `packages/rawengine-schema/samples/computational-merge-panorama-apply-app-server-tool-call-validation-v1.json`
  - Tool manifest: `packages/rawengine-schema/samples/computational-merge-app-server-tool-manifest-v1.json`
- `panorama(adapter): evaluate OpenCV stitching backend`
- `validation(panorama): add panorama performance tests`
  - Fixture manifest: `fixtures/panorama/panorama-performance-fixtures.json`
  - Validation: `bun run check:panorama-performance-fixtures`
  - Doc: `docs/panorama/performance-validation-contract-2026-06-14.md`

#### Milestone 12: Focus Stacking

- `consult(focus-stack): get focus stacking architecture review`
  - Doc: `docs/focus-stacking/architecture-consult-summary-2026-06-14.md`
- `focus(schema): define focus stack artifact schema`
  - Schema: `packages/rawengine-schema/src/rawEngineSchemas.ts#focusStackArtifactV1Schema`
  - Sample: `packages/rawengine-schema/samples/focus-stack-artifact-v1.json`
- `focus(align): add alignment path`
  - Doc: `docs/focus-stacking/alignment-path-2026-06-14.md`
- `focus(sharpness): add sharpness map generation`
  - Doc: `docs/focus-stacking/sharpness-map-generation-2026-06-14.md`
- `focus(blend): add blending strategy`
  - Doc: `docs/focus-stacking/blending-strategy-2026-06-14.md`
- `focus(retouch): add artifact retouch strategy`
  - Doc: `docs/focus-stacking/retouch-artifact-strategy-2026-06-14.md`
- `validation(focus): add focus bracket fixture set`
  - Doc: `docs/focus-stacking/focus-bracket-fixture-manifest-2026-06-14.md`
- `ui(focus): add focus stack UI`
  - Component: `src/components/modals/FocusStackModal.tsx`
  - Schema: `src/schemas/focusStackUiSchemas.ts`
  - Surface: thumbnail multi-select productivity menu and plan-only preflight modal.
- `api(focus): add focus stack API tools`
  - Doc: `docs/focus-stacking/api-tool-contract-2026-06-14.md`
- `validation(focus): add focus stack performance tests`
  - Doc: `docs/focus-stacking/performance-validation-contract-2026-06-14.md`
- `docs(focus): define RAW normalization and color policy`
  - Issue: #1057
  - Doc: `docs/focus-stacking/raw-normalization-color-policy-2026-06-14.md`
- `focus(runtime): add plan-only dry-run preflight`
  - Issue: #1058
  - Utility: `packages/rawengine-schema/src/focusStackPreflight.ts`
- `validation(focus): add tiny synthetic bracket generator`
  - Issue: #1059
  - Fixture manifest: `fixtures/focus-stacking/focus-synthetic-bracket-fixtures.json`
  - Check: `bun run check:focus-fixtures`
- `focus(runtime): add CPU translation alignment smoke`
  - Issue: #1060
  - Check: `bun run check:focus-alignment-smoke`
- `focus(runtime): add CPU sharpness-map smoke`
  - Issue: #1061
- `focus(runtime): add weighted-sharpness preview blend smoke`
  - Issue: #1062
- `agent(focus): bind app-server focus tools to command bus`
  - Issue: #1063
  - Check: `bun run schema:focus-app-server`

#### Milestone 13: Super-Resolution

- `consult(super-resolution): get super-resolution strategy review`
  - Doc: `docs/super-resolution/strategy-consult-summary-2026-06-14.md`
- `sr(modes): define single-image and multi-image modes`
  - Doc: `docs/super-resolution/mode-taxonomy-2026-06-14.md`
- `sr(policy): define conservative professional output policy`
  - Doc: `docs/super-resolution/conservative-output-policy-2026-06-13.md`
- `sr(align): add multi-image alignment path`
  - Doc: `docs/super-resolution/multi-image-alignment-path-2026-06-13.md`
- `sr(detail): add detail reconstruction strategy`
  - Doc: `docs/super-resolution/detail-reconstruction-strategy-2026-06-13.md`
- `validation(sr): add resolution chart fixtures`
  - Doc: `docs/super-resolution/resolution-chart-fixture-manifest-2026-06-13.md`
- `validation(sr): add real photo fixtures`
  - Doc: `docs/super-resolution/real-photo-fixture-manifest-2026-06-13.md`
- `ui(sr): add super-resolution UI`
- `api(sr): add super-resolution API tools`
- `validation(sr): add performance tests`
  - Doc: `docs/super-resolution/performance-validation-contract-2026-06-14.md`
  - Script: `scripts/check-super-resolution-performance-fixtures.ts`
  - Fixture manifest: `docs/validation/super-resolution-performance-fixtures.json`
- `validation(sr): add visual artifact review checklist`
  - Doc: `docs/super-resolution/visual-artifact-review-checklist-2026-06-14.md`

#### Milestone 14: OpenAI App-Server Agent

- `consult(agent): get app-server architecture review`
- `ai(audit): inventory RapidRAW built-in AI features`
- `ai(api): define provider abstraction for local self-hosted and cloud AI`
- `agent(docs): add app-server design doc`
- `agent(schema): add dynamic tool schema package`
- `agent(schema): add tool call validator`
- `agent(project): add project and library tools`
- `agent(preview): add preview histogram and scope tools`
- `agent(edit-graph): add edit graph tools`
- `agent(tone-color): add tone and color tools`
- `agent(layers-masks): add layer and mask tools`
- `agent(computational): add merge tools`
- `ai(app-server): expose AI mask tools through Codex app-server`
- `ai(app-server): expose AI enhancement tools through Codex app-server`
- `ai(provenance): record model backend and settings in sidecars`
- `ai(approval): require approval for cloud AI and generative edits`
- `agent(export): add export tools`
- `agent(approval): add approval boundaries`
- `agent(audit): add tool-call audit log`
- `validation(agent): add agent replay tests`
- `validation(ai): add AI tool schema and replay tests`
- `validation(ai): add unavailable-provider fallback tests`
- `validation(agent): add prompt injection fixtures`
- `agent(demo): add agent demo workflow`

#### Milestone 15: Professional Workflow Polish

- `ui(shortcuts): add keyboard shortcut editor`
- `ui(command-palette): add command palette`
- `ui(compare): add compare and survey views`
- `ui(reference): add reference image workflow`
- `export(recipes): add export recipes UI`
- `export(queue): add batch export queue`
- `tethering(research): research tethering support`
- `library(sessions): add sessions workflow`
- `library(filters): add smart albums and filters`
- `import(presets): add import presets`
- `metadata(templates): add metadata templates`
- `ui(workspaces): add custom workspace layouts`
- `validation(ui): add high-DPI visual QA`
- `validation(a11y): add accessibility pass`
- `docs(sample): add onboarding sample project`

#### Milestone 16: Release Hardening

- `release(crash): add crash and error reporting strategy`
- `release(privacy): add privacy policy`
- `release(telemetry): decide telemetry opt-in`
- `release(macos): add signing plan`
- `release(macos): add notarization workflow`
- `release(update): research update mechanism`
- `release(notes): add release notes automation`
- `docs(site): add documentation site`
- `docs(user-guide): add user guide`
- `docs(api-guide): add developer API guide`
- `docs(agent-guide): add sample agent guide`
- `release(benchmarks): add benchmark report`
- `docs(limitations): add known limitations page`

### Milestone 0: Maintained Plan Artifact

Goal: add the mega PRD/technical plan as the first maintained `RapidRaw` fork repository artifact.

Issues:

- `docs(plan): add maintained RawEngine product and technical plan`
  - Labels: `area:docs`, `type:plan`, `priority:p0`, `pr:size-small`, `validation:docs`.
  - Blocked by: none.
  - Scope: add `RAW_EDITOR_PLAN.md` to the public `RapidRaw` fork repo.
  - Out of scope: clone RapidRAW, implement tooling, create CI, create product code.
  - PR budget: documentation-only, ideally under 500 changed non-generated lines if the plan is split later; the initial mega doc can exceed this only because it is the founding artifact.
  - Acceptance criteria: plan includes product scope, architecture, milestones, issue rules, validation gates, source references, and the active Codex goal.
  - Validation evidence: markdown renders, links reviewed, git diff only contains intended docs.
- `docs(readme): point contributors to the RawEngine plan`
  - Labels: `area:docs`, `type:docs`, `priority:p1`, `pr:size-small`, `validation:docs`.
  - Blocked by: `docs(plan): add maintained RawEngine product and technical plan`.
  - Scope: minimal README that explains current planning state and links to the plan.
  - Acceptance criteria: README does not overclaim implementation status.
- `docs(process): add plan maintenance rule`
  - Labels: `area:docs`, `type:docs`, `priority:p1`, `pr:size-small`, `validation:docs`.
  - Blocked by: `docs(plan): add maintained RawEngine product and technical plan`.
  - Scope: document that major architecture/product/validation changes must update the plan.
  - Acceptance criteria: PR template or contribution note includes plan update checkbox.

Definition of done:

- The public repo contains the plan.
- The plan is explicitly maintained.
- The first PR is documentation-only unless the user expands scope.
- No implementation work has started.

### Milestone 0.1: Project Charter And Fork Governance

Goal: establish the public project, fork strategy, and work tracking.

Issues:

- `repo(github): use public RapidRaw fork as project repository`
  - Labels: `area:repo`, `type:implementation`, `priority:p0`, `pr:size-small`.
  - Blocked by: completion of planning goal.
  - Scope: use the public `RapidRaw` fork as the project repository.
  - Acceptance criteria: fork is public, points back to `CyberTimon/RapidRAW`, and contains the maintained plan artifact.
- `repo(fork): create public RapidRAW fork for nested checkout`
  - Labels: `area:repo`, `type:implementation`, `priority:p0`, `pr:size-small`.
  - Blocked by: public repo decision.
  - Scope: create public fork of `CyberTimon/RapidRAW`.
  - Acceptance criteria: fork exists and license metadata remains visible.
- `repo(topology): document origin/upstream remote policy`
  - Labels: `area:repo`, `type:docs`, `priority:p0`, `pr:size-small`, `validation:docs`.
  - Blocked by: fork creation.
  - Scope: document `RawEngine` parent repo and nested `RapidRaw/` fork checkout.
  - Acceptance criteria: no ambiguity between parent repo and nested fork.
- `repo(governance): protect main and require pull requests`
  - Labels: `area:repo`, `type:implementation`, `priority:p0`, `risk:high`.
  - Blocked by: public repo creation.
  - Scope: configure branch protection.
  - Acceptance criteria: no direct pushes, required checks configured as they become available, force pushes disabled.
- `repo(templates): add issue templates`
  - Labels: `area:repo`, `type:docs`, `priority:p1`, `pr:size-small`, `validation:docs`.
  - Blocked by: plan artifact.
  - Scope: create issue templates matching this plan.
- `repo(templates): add PR template with validation evidence ledger`
  - Labels: `area:repo`, `type:docs`, `priority:p1`, `pr:size-small`, `validation:docs`.
  - Blocked by: plan artifact.
  - Scope: create PR template requiring how/why/validation/risk.
- `repo(labels): create labels for area type priority risk validation and PR size`
  - Labels: `area:repo`, `type:implementation`, `priority:p1`, `pr:size-small`.
  - Blocked by: public repo creation.
  - Scope: create labels listed in this plan.
- `repo(security): add security policy`
  - Labels: `area:repo`, `type:security`, `priority:p1`, `pr:size-small`, `validation:security`.
  - Blocked by: public repo creation.
  - Scope: add security policy and reporting expectations.
- `repo(license): add AGPL compliance note for RapidRAW fork`
  - Labels: `area:repo`, `type:docs`, `priority:p0`, `risk:critical`, `validation:license`.
  - Blocked by: fork decision.
  - Scope: document AGPL expectations, notices, source-publication obligations, and dependency license gates.

Definition of done:

- Public repo exists.
- `main` is protected.
- Direct pushes to `main` are blocked by GitHub.
- Project issues and milestones exist.
- Initial planning document is committed by PR, not direct main commit after protection exists.

### Milestone 0.5: RapidRAW Baseline Snapshot

Goal: prove the public fork builds and behaves like the selected upstream baseline before hardening or migration work.

Issues:

- `baseline(upstream): record RapidRAW upstream commit and dependency state`
  - Labels: `area:repo`, `type:docs`, `priority:p0`, `pr:size-small`, `validation:docs`.
  - Blocked by: nested fork checkout.
  - Scope: record upstream SHA, fork SHA, package manager files, Rust toolchain, Tauri version, workflow files.
  - Acceptance criteria: baseline note exists and source state is reproducible.
- `baseline(build): run existing RapidRAW install lint test and build commands`
  - Labels: `area:tooling`, `type:test`, `priority:p0`, `pr:size-small`, `validation:build`.
  - Blocked by: upstream commit record.
  - Scope: run existing commands without changing tooling.
  - Acceptance criteria: results documented; failures become issues instead of being silently mixed into migration PRs.
- `baseline(ci): create minimal CI mirror of existing upstream commands`
  - Labels: `area:ci`, `type:ci`, `priority:p0`, `pr:size-medium`, `validation:build`.
  - Blocked by: baseline command run.
  - Scope: add CI that mirrors current upstream commands before strictness.
  - Acceptance criteria: CI reports baseline pass/fail clearly.
- `baseline(render): capture representative baseline screenshots and render outputs`
  - Labels: `area:render`, `type:test`, `priority:p1`, `pr:size-medium`, `validation:render`.
  - Blocked by: build baseline.
  - Scope: capture the current render-testability state before UI/runtime changes. If the Vite browser surface cannot render because of Tauri coupling, document the blocker with console evidence and a screenshot artifact instead of faking a successful render baseline.
  - Acceptance criteria: artifacts recorded with source/license metadata where images are used; browser/Tauri render blocker documented if present; follow-up issue created for a real macOS screenshot or Tauri-aware visual harness (#292).

Definition of done:

- The fork baseline is documented.
- Existing failures are tracked as baseline debt.
- Later strictness and Bun changes have a known comparison point.

### Milestone 1: Shift-Left Quality Foundation

Goal: make the fork safe to change.

Issues:

- `tooling(scripts): audit RapidRAW package scripts and CI entrypoints`
  - Labels: `area:tooling`, `type:docs`, `priority:p0`, `pr:size-small`, `validation:docs`.
  - Blocked by: Milestone 0.5.
  - Scope: map current npm/Bun/Vite/Tauri/Rust commands and workflow usage.
  - Acceptance criteria: command inventory exists, current failures linked to issues.
  - Validation evidence: command list and baseline outputs.
- `tooling(bun): add Bun package manager support`
  - Labels: `area:tooling`, `type:implementation`, `priority:p0`, `pr:size-medium`, `validation:build`.
  - Blocked by: script audit.
  - Scope: add Bun support without broad package churn beyond required lockfile changes.
  - Acceptance criteria: `bun install --frozen-lockfile` works locally and in CI.
  - Validation evidence: install logs, lockfile diff, CI run.
- `tooling(bun): migrate frontend CI install and script execution to Bun`
  - Labels: `area:ci`, `area:tooling`, `type:ci`, `priority:p0`, `pr:size-medium`, `validation:build`.
  - Blocked by: Bun package manager support.
  - Scope: use `oven-sh/setup-bun@v2`, `bun install`, and `bun run` for compatible frontend jobs.
  - Acceptance criteria: CI uses Bun for frontend path; any Node exceptions are documented.
- `tooling(tsconfig): harden TypeScript compiler flags in small slices`
  - Labels: `area:tooling`, `type:implementation`, `priority:p0`, `risk:medium`, `validation:types`.
  - Blocked by: script audit.
  - Scope: enable strict flags through the split issues listed in Section 9.1.
  - Acceptance criteria: typecheck passes with each flag; no broad unrelated refactors.
- `tooling(eslint): adopt strict type-aware ESLint`
  - Labels: `area:tooling`, `type:implementation`, `priority:p0`, `risk:medium`, `validation:lint`.
  - Blocked by: script audit and TypeScript project service readiness.
  - Scope: use strict type-checked rules and parser project service.
  - Acceptance criteria: lint passes with no warnings.
- `tooling(eslint): add React hooks accessibility import and async safety rules`
  - Labels: `area:frontend`, `area:tooling`, `type:implementation`, `priority:p0`, `validation:lint`, `validation:accessibility`.
  - Blocked by: strict ESLint foundation.
  - Scope: add React/hooks/a11y/import/no-floating-promises style checks.
  - Acceptance criteria: lint passes, rule exceptions documented.
- `tooling(check): add local check scripts mirroring CI`
  - Labels: `area:tooling`, `type:implementation`, `priority:p0`, `pr:size-small`, `validation:build`.
  - Blocked by: script audit.
  - Scope: define `check`, `check:quick`, `typecheck`, `lint`, `test`, `format:check`, Rust checks.
  - Acceptance criteria: local commands match CI job commands.
- `tooling(hooks): add pre-commit main guard`
  - Labels: `area:tooling`, `type:implementation`, `priority:p0`, `pr:size-small`.
  - Blocked by: local check scripts.
  - Scope: block commits while on `main`.
  - Acceptance criteria: attempted commit on `main` fails with clear message.
- `tooling(hooks): add pre-push main ref guard`
  - Labels: `area:tooling`, `type:implementation`, `priority:p0`, `pr:size-small`.
  - Blocked by: local check scripts.
  - Scope: block pushes to `refs/heads/main`, including `HEAD:main` from feature branches.
  - Acceptance criteria: attempted push to main fails locally.
- `tooling(hooks): add staged lint and format checks`
  - Labels: `area:tooling`, `type:implementation`, `priority:p1`, `validation:lint`.
  - Blocked by: ESLint and formatter decision.
  - Scope: run fast staged checks without making commits painfully slow.
  - Acceptance criteria: staged violations fail before commit.
- `ci(quality): remove continue-on-error from required checks`
  - Labels: `area:ci`, `type:ci`, `priority:p0`, `risk:high`, `validation:build`.
  - Blocked by: baseline CI and local check scripts.
  - Scope: required quality gates fail hard.
  - Acceptance criteria: no required quality gate has `continue-on-error: true`.
- `ci(rust): enforce rustfmt clippy warnings-as-errors and tests`
  - Labels: `area:rust`, `area:ci`, `type:ci`, `priority:p0`, `validation:rust`.
  - Blocked by: baseline CI.
  - Scope: Rust formatting, clippy `-D warnings`, tests.
  - Acceptance criteria: CI fails on Rust warnings/errors.
- `ci(security): add dependency vulnerability checks`
  - Labels: `area:ci`, `type:security`, `priority:p1`, `validation:security`.
  - Blocked by: package manager baseline.
  - Scope: JS and Rust vulnerability checks.
  - Acceptance criteria: vulnerability reports uploaded or linked.
- `ci(license): add dependency license checks`
  - Labels: `area:ci`, `type:security`, `priority:p1`, `risk:critical`, `validation:license`.
  - Blocked by: package manager baseline.
  - Scope: license allow/deny policy.
  - Acceptance criteria: incompatible licenses fail CI.
- `deps(audit): report latest major and minor package and crate versions`
  - Labels: `area:tooling`, `type:implementation`, `priority:p1`, `pr:size-small`, `validation:build`.
  - Blocked by: package manager baseline.
  - Scope: add local and CI-readable reports for outdated JavaScript packages, Rust crates, GitHub Actions, Node, Bun, Tauri, Rust tooling, and validation CLIs, including latest compatible minor and latest stable major targets.
  - Acceptance criteria: audit output distinguishes patch/minor updates from major migrations and records which major migration issues exist, need creation, or are explicitly deferred with a blocker.
  - Validation evidence: audit command output and generated report diff.
- `deps(minor): update JavaScript packages to latest stable compatible releases`
  - Labels: `area:tooling`, `type:implementation`, `priority:p2`, `pr:size-medium`, `validation:build`, `validation:security`.
  - Blocked by: dependency version audit.
  - Scope: apply patch/minor JavaScript package updates that do not require major migration work.
  - Acceptance criteria: lockfile is current for compatible releases, license/security/type/lint checks pass, and any remaining major updates have linked issues.
- `deps(minor): update Rust crates to latest stable compatible releases`
  - Labels: `area:rust`, `type:implementation`, `priority:p2`, `pr:size-medium`, `validation:rust`, `validation:security`.
  - Blocked by: dependency version audit.
  - Scope: apply compatible Rust crate updates without bundling breaking migrations.
  - Acceptance criteria: lockfile is current for compatible releases, Rust fmt/check/clippy/test/license/security gates pass, and any remaining major updates have linked issues.
- `deps(major): create one migration issue per discovered major package upgrade`
  - Labels: `area:tooling`, `type:docs`, `priority:p2`, `pr:size-small`, `validation:docs`.
  - Blocked by: dependency version audit.
  - Scope: create or update one GitHub issue for each discovered major version bump across JavaScript, Rust, GitHub Actions, Node/Bun/Tauri tooling, and validation CLIs before implementation starts.
  - Acceptance criteria: every major update is represented by a dedicated issue or a documented compatibility-group issue with migration notes, upstream breaking-change links, validation commands, and rollback notes.
- `ci(docs): add markdown and link checks`
  - Labels: `area:ci`, `area:docs`, `type:ci`, `priority:p1`, `validation:docs`.
  - Blocked by: plan artifact.
  - Scope: markdown lint and link validation.
  - Acceptance criteria: broken internal docs links fail CI.

Definition of done:

- Local `bun run check` passes.
- CI required gates pass.
- Hook blocks local commits on `main`.
- Hook blocks local pushes to `main`.
- No warnings are allowed in required lint jobs.

### Milestone 2: CI Build Matrix And Release Skeleton

Goal: make full builds reliable and parallelized.

Issues:

- Split GitHub Actions into fast validation, full build, image quality, performance, and release workflows. Current topology:
  `docs/ci/workflow-topology-2026-06-11.md`.
- Add stable aggregate PR required gate.
- Require that aggregate gate in the active `Protect main` ruleset.
- Keep macOS app smoke on `main` push and manual `workflow_dispatch`; do not make long macOS Rust/app jobs PR aggregate blockers.
- Add matrix strategy for platform builds. Current optional inherited platform
  matrix: `docs/ci/optional-platform-build-matrix-2026-06-11.md`.
- Add caching for Bun, Cargo, Tauri, and build artifacts. Current cache policy:
  `docs/ci/cache-policy-2026-06-11.md`.
- Replace full PR package builds with a macOS no-bundle smoke path where practical, while keeping full package builds on `main` and release.
- Wire reusable build `upload-artifacts` input so PRs can skip uploads when artifacts are not useful and main/release can keep evidence.
- Add release workflow skeleton. Current unsigned artifact dry-run:
  `docs/release/unsigned-release-artifact-workflow-2026-06-11.md`.
- Add SBOM/checksum generation. Current release metadata doc:
  `docs/release/release-metadata-checksums-sbom-2026-06-11.md`.
- Add notarization/signing placeholder documentation:
  `docs/release/macos-signing-notarization-placeholders-2026-06-11.md`.
- Add failure artifact uploads. Current failure artifact policy:
  `docs/ci/failure-artifacts-2026-06-11.md`.
- Merge queue evaluation is captured in
  `docs/ci/merge-queue-evaluation-2026-06-12.md`; it remains deferred until
  macOS queue latency and merge-group routing are ready.

Definition of done:

- PR validation jobs run in parallel.
- `PR CI / required` exists, is enforced by the `Protect main` ruleset, blocks pending/failing PRs, and allows auto-merge only after success.
- macOS Rust/app smoke is required on `main` push and available manually before merge. PRs must record the changed-path routing decision but must not wait on the long macOS smoke jobs.
- Non-required platform builds are clearly marked.
- Release workflow can produce unsigned draft artifacts.

### Milestone 3: Baseline Audit And Regression Harness

Goal: understand RapidRAW's current behavior and lock it down before changing internals.

Issues:

- Document current RapidRAW architecture.
- Document current image pipeline.
- Document current sidecar format.
- Document current GPU pipeline.
- Document current mask/layer model.
- Document current AI hooks.
- Add sidecar roundtrip tests.
- Add edit history replay tests.
- Add baseline render smoke tests.
- Add fixture download policy.
- Create initial public fixture manifest.
- Add golden render command.
- Add image artifact comparison script.
- Add performance smoke script.

Definition of done:

- Baseline behavior is documented.
- Core existing features have smoke tests.
- Render outputs can be regenerated and compared.
- Fixtures have license/source metadata.

### Milestone 3.5: Contract Freeze And Validation Contracts

Goal: freeze the architecture contracts that would be expensive to change after layers, color, Negative Lab, merge artifacts, AI migration, and app-server tools are implemented.

Issues:

- Audit current broad edit payload seams, especially `jsAdjustments`, sidecar writes, mask/layer data, and current AI/native command boundaries.
- Audit current negative conversion behavior and decide whether it is wrapped, quarantined, replaced, or allowed only as a legacy compatibility path.
- Write `ADR-API-001`, `ADR-GRAPH-001`, `ADR-COLOR-001`, `ADR-MAC-001`, `ADR-GPU-001`, `ADR-COORD-001`, `ADR-MASK-001`, `ADR-MASK-002`, `ADR-ART-001`, `ADR-AI-001`, `ADR-AGENT-001`, `ADR-FIX-001`, `ADR-VALID-001`, and `ADR-LIC-001`.
- Add command/query envelope type stubs and schema generation spike.
- Add `packages/rawengine-schema/` with Zod schemas, JSON Schema generation, TypeScript types, OpenAI/app-server tool schema generation, sample payloads, and schema manifest hashes.
- Add a pure Rust `edit_core` skeleton with no Tauri/UI coupling.
- Add a `bridge` adapter skeleton with typed `BridgeResult` and `RawEngineError` responses.
- Add an edit graph skeleton with a legacy adjustment node so existing RapidRAW adjustment snapshots can migrate incrementally.
- Add an in-memory command bus with no-op and scalar edit examples.
- Add a headless validate/replay command.
- Add read-only command replay smoke harness.
- Add fixture manifest schema lint and hash verification stub.
- Add CPU reference render smoke fixture and gate name.
- Add synthetic golden harness before introducing real RAW fixtures.
- Add changed-file to validation-gate mapping so PRs know which gates they owe.
- Add app-server tool schema drift placeholder.
- Create follow-up GitHub issues for ADR implementation gaps.

Definition of done:

- Every high-risk feature family has a named blocking ADR or an explicit decision that no ADR is needed.
- Every high-risk feature family has a named validation gate and an owner path for local, CI, nightly, or release validation.
- The command envelope, query envelope, edit graph schema, fixture manifest, derived artifact, AI provenance, and app-server tool registry have initial versioned schemas or tracked issues.
- New bridge contracts avoid `Result<T, String>`, large base64 result payloads, and untyped native errors.
- Mutating command samples include `expectedGraphRevision`, actor metadata, approval metadata, dry-run or preview options, provenance, and typed result/error samples.
- HDR, panorama, focus-stack, super-resolution, generated-positive, denoise/enhance, and AI output planning treats results as graph artifact nodes with provenance and invalidation rules.
- UI-only edit paths are either routed through commands, documented as temporary seams, or tracked with removal issues.
- The plan and GitHub issues make it clear which validations are required before layer, mask, color, Negative Lab, merge, AI, or agent implementation begins.

### Milestone 4: Versioned Edit Graph And API Foundation

Goal: make UI, CLI, tests, and agent share one editing contract.

Issues:

- Define versioned edit operation schema.
- Define layer schema.
- Define mask schema.
- Define merge artifact schema.
- Define export recipe schema.
- Add schema validation.
- Add schema migration mechanism.
- Add command bus for edit operations.
- Route representative UI operations through command bus.
- Add undo/redo command tests.
- Add CLI command for headless render.
- Add API documentation.

Definition of done:

- A representative edit can be applied through UI, API, CLI, and test harness.
- Edit commands serialize and replay deterministically.
- Schema changes require tests.

### Milestone 5: Color Pipeline Foundation

Goal: establish a professional color architecture.

Issues:

- Audit current RapidRAW color pipeline.
- Decide working color space.
- Decide display transform strategy.
- Decide camera profile strategy.
- Add color pipeline design doc.
- Add ColorChecker fixture set.
- Add DeltaE measurement harness.
- Add histogram/scope validation.
- Add CPU/GPU parity checks for core color operations.
- Add white balance picker tests.
- Add camera profile lookup tests.
- Add chromatic adaptation module or integration plan.
- Add gamut mapping plan.
  - Schema/fixture contract: `docs/color/gamut-mapping-plan-2026-06-15.md`.
  - Runtime proof required later before any preview/export applied claim.

Definition of done:

- The color pipeline is documented and testable.
- Color chart renders have measurable baselines.
- Future color changes fail CI/nightly when they drift unexpectedly.

### Milestone 6: Capture One-Class Color Editing

Goal: build the core professional color tools.

Issues:

- Add advanced selective color ranges.
  - Shared range metadata and WGSL parity validation are present.
- Add range smoothness/falloff controls.
  - Default falloff math and shader parity validation are present.
- Add skin tone uniformity controls.
  - Uniformity math and fixture validation are present.
- Add color mask creation from selected range.
  - Selected-range to color-mask conversion is present.
- Add color grading wheels refinement.
- Add color balance RGB-style module.
- Add channel mixer.
- Add black-and-white mixer.
- Add profile/tone curve controls.
- Add saved color style presets.
- Add ICC/profile export research issue.
- Add UI polish for color tools.

Definition of done:

- User can isolate and adjust specific color ranges precisely.
- User can normalize skin tone variation.
- Color edits can be saved, copied, pasted, and invoked through API.
- Tests cover schema, render smoke, and representative output.

### Milestone 7: Layers And Masking

Goal: make local editing a first-class pro workflow.

Issues:

- Define final layer UX model.
- Add layer stack UI polish.
- Add layer opacity and visibility.
- Add per-layer adjustments.
- Add layer reorder/duplicate/delete.
- Add brush mask improvements.
- Add linear/radial gradient masks.
- Add luminance range masks.
- Add color range masks.
- Add mask add/subtract/intersect.
- Add mask feather/density/refine.
- Add mask overlay modes.
- Add mask copy/paste.
- Add AI subject/sky/background mask audit.
- Add people/parts mask research issue.
- Add mask schema/API tests.

Definition of done:

- User can build multi-layer local edits with combined masks.
- All layer/mask operations are API-callable.
- Mask edits are undoable, replayable, and tested.

### Milestone 8: Detail, Denoise, And Wavelet Tools

Goal: compete on fine detail and image cleanup.

Issues:

- Audit current sharpening/noise tools.
- Add capture sharpening.
- Add output sharpening.
- Add deconvolution/lens deblur research.
- Add local contrast refinement.
- Add wavelet/detail-by-scale design.
- Add wavelet/detail-by-scale implementation.
- Add chroma/luma noise separation.
- Add synthetic noise metric harness.
  - Consult result: accepted a validation-only first PR with deterministic
    public fixtures, Zod manifest checks, luma/chroma sigma, edge, texture, and
    high-frequency sentinel metrics.
  - Runtime status: synthetic validation only. This does not prove real RAW
    quality, preview/export parity, or runtime denoise quality.
  - Next iterations: private RAW evidence, preview/export metric parity,
    runtime chroma/luma denoise candidates, then consult-backed threshold
    tightening.
- Iterate advanced detail quality in small consult-backed steps. For deblur,
  denoise, AI denoise, sharpening, and color-science-adjacent detail behavior,
  each step should name whether it is research-only, schema-only,
  validation-only, dry-run/app-server-capable, runtime apply-capable, or
  real-image-proven.
- Denoise/deblur consult sequence, 2026-06-14:
  - Accepted: implement denoise before deblur runtime because deblur metrics are
    contaminated by noise amplification.
  - Accepted: start with deterministic contracts and fixtures, then CPU
    reference kernels, then preview/export parity, then UI/API wiring, then E2E
    or equivalent workflow proof.
  - Accepted: first credible denoise should separate luma/chroma noise in a
    scene-linear post-demosaic path before any raw-domain or AI denoise claims.
  - Accepted: first credible deblur should be constrained deconvolution with
    synthetic PSF fixtures, ringing/halo metrics, and conservative strength
    limits before lens-profile or AI deblur claims.
  - Accepted: GPU/Metal implementations must follow CPU references with
    explicit tolerances; no GPU-only detail feature PRs.
  - Deferred: AI denoise/deblur as the first runtime path, raw-domain
    CFA-aware denoise, exact lens deconvolution, model weights, and broad
    generative enhancement claims.
  - Required gates to add over iterations: `check:denoise-fixtures`,
    `check:denoise-cpu-reference`, `check:denoise-preview-runtime`,
    `check:denoise-preview-export-parity`, `check:denoise-e2e`,
    `check:deblur-fixtures`, `check:deblur-cpu-reference`,
    `check:deblur-ringing`, `check:deblur-preview-runtime`,
    `check:deblur-preview-export-parity`, `check:deblur-e2e`,
    `check:detail-stage-order`, `check:detail-artifacts`, and
    `check:detail-performance-macos`.
  - Partial states must stay explicit: contracts, schemas, metrics, CPU
    references, preview-only runtime, export parity, UI/API wiring, and E2E
    proof are separate closure states.
- Add high ISO fixture set. Initial manifest entries separate project-generated
  public-CI placeholders from real-photo private-review placeholders until
  payload rights, hashes, and thresholds are supplied.
- Add private real RAW crop evidence ledger.
- Add denoise fixture contract.
  - Runtime status: validation-only fixture/schema contract. This proves
    synthetic and private-placeholder coverage for denoise metrics, but does
    not prove runtime denoise quality, preview/export parity, real RAW quality,
    or E2E workflow behavior.
- Add detail stage-order and artifact gates.
  - Runtime status: validation-only. This proves detail stage ordering and
    artifact completion-state bookkeeping, but does not prove denoise/deblur
    preview/export parity, real RAW quality, UI/API wiring, or E2E workflow
    behavior.
- Add denoise CPU reference runtime.
  - Runtime status: CPU-reference-only. This must prove deterministic synthetic
    before/noisy/denoised fixture artifacts and bounded metrics, but must not
    claim preview/export parity, real RAW quality, GPU parity, UI/API wiring, or
    E2E workflow behavior.
- Add deblur fixture contract.
  - Runtime status: validation-only fixture/schema contract. This proves
    constrained PSF case coverage, ringing/halo/noise amplification threshold
    coverage, and reject-case coverage. It does not prove CPU runtime deblur
    quality, preview/export parity, real RAW quality, UI/API behavior, or E2E
    workflow behavior.
  - Follow-ups: CPU reference runtime #1180, UI/API wiring #1181, real RAW
    quality pack #1182, E2E workflow proof #1183, and shared preview/export
    parity #1150.
- Add deblur CPU reference runtime.
  - Runtime status: CPU-reference-only. This proves deterministic constrained
    Gaussian synthetic apply/skip behavior for accepted and rejected fixture
    cases, but does not prove preview/export parity, real RAW quality, GPU
    parity, UI/API wiring, or E2E workflow behavior.
- Add defringe improvements.
- Add dust spot visualization.
- Add AI denoise research issue.

Definition of done:

- Detail controls are strong enough for real RAW finishing.
- Changes are tested on high ISO, fine texture, and edge fixtures.
- Denoise/deblur feature issues are not complete until the same parameters
  affect preview and export, artifacts are generated, objective metrics pass,
  recipe/API state persists, and E2E or equivalent workflow proof exists.
- Performance remains interactive for common files.

### Milestone 9: Film Simulation Lab

Goal: make film looks and negative processing high quality, controllable, legally safe, and workflow-complete.

Issues:

- Define film simulation architecture.
- Add HaldCLUT import validation.
- Add open built-in look collection.
- Add film grain model.
- Add halation model.
- Add bloom/glow model.
- Add black-and-white film controls.
- Add negative conversion improvements.
- Add film look browser UI.
- Add side-by-side film comparison view.
- Add film preset save/share.
- Add legal review checklist for bundled looks.
- Add film simulation fixture outputs.
- Consult on the full negative processing lab before design or implementation.
- Define negative processing architecture.
- Define density-domain inversion model.
- Define preset naming and legal policy.
- Define AcquisitionProfile, ProcessProfile, and StockProfile boundaries.
- Define WGPU overlay coordinate contract.
- Audit inherited upstream negative conversion logic.
- Define profile schema versioning and migration policy.
- Design dedicated negative lab workspace.
- Design roll setup and frame queue.
- Design QC overlays and sample readouts.
- Design roll cockpit and frame health grid.
- Design expert densitometer inspector.
- Design base sampling studio.
- Design roll matching console.
- Design profile comparison matrix.
- Design agent activity and command provenance panel.
- Define negative conversion operation schema.
- Define acquisition profile schema.
- Define process and stock profile schemas.
- Define negative lab provenance record schema.
- Expose negative lab command surface.
- Expose safe app-server tools for negative lab.
- Add scan setup health model.
- Detect auto-corrected and lossy inputs.
- Add durable acquisition contract.
- Add failure-mode taxonomy.
- Support scan input modes and roll sessions.
- Add frame splitting and border detection.
- Support half-frame, panoramic, medium-format, and sheet-film scans.
- Add target and step-wedge calibration workflows.
- Add film base sampling controls.
- Add per-channel inversion curves.
- Classify objective, semi-objective, and creative operations.
- Define display and export profile behavior.
- Add density normalization and process profiles.
- Add black-and-white process model.
- Add remjet and cinema scan assumptions.
- Add roll-level batch consistency workflow.
- Define film stock preset metadata and legal policy.
- Create major film stock registry schema.
- Define stock coverage tiers and claim levels.
- Add stock source citation and review model.
- Add generic process preset mapping.
- Add stock registry refresh workflow.
- Add preset provenance inspector requirements.
- Add generic legally safe built-in presets.
- Add stock-family research mappings after legal review.
- Add measured-profile fixture format.
- Define named stock measurement methodology.
- Add user and community profile provenance rules.
- Split major stock-family coverage into small issues.
- Add frame border and crop detection.
- Add scanner and camera-scan profile inputs.
- Add contact sheet proofing reports.
- Add density and clipping warning reports.
- Add positive variant provenance.
- Add conversion report and profile roundtrip exports.
- Add negative scan fixture manifest.
- Add fixture licensing and provenance policy.
- Add calibration target fixture manifest.
- Add preset registry lint.
- Add CPU reference conversion fixtures.
- Add synthetic negative generator.
- Add numeric quality gates.
- Add DeltaE, gray-ramp, and ColorChecker gates.
- Add GPU parity tolerance checks.
- Add prohibited asset and claim lint.
- Add public/private fixture storage lint.
- Add warning stability gates.
- Add profile scope and confidence tier lint.
- Add WGPU overlay alignment tests.
- Add color and black-and-white negative render tests.
- Add roll consistency and QC overlay tests.
- Add full lab UI workflow regression tests.
- Add app-server dry-run and rollback tests.
- Add macOS performance benchmarks.
- Add negative workflow user guide.

Definition of done:

- Film looks are controllable beyond a simple LUT.
- Built-in looks are legally safe.
- Film simulations are API-callable and regression tested.
- Negative processing has a dedicated UI plan and implementation path.
- Major film stock presets have provenance and legal review.
- Acquisition, process, and stock profile boundaries are explicit and enforced by schemas, UI copy, and validation.
- Acquisition assumptions persist in roll/session state, dry-runs, reports, and app-server responses.
- Named-stock profiles are measured, fixture-backed, legally reviewed, and separated from generic/user/reference profile tiers.
- Negative conversion uses a documented density-domain model with input profile assumptions.
- Roll/session workflows support shared base samples, anchor frames, per-frame overrides, and positive variant provenance.
- Negative lab commands are API-callable, replayable, undoable, batchable, and safe for app-server agent tools.
- The major-stock preset registry is versioned, provenance-backed, legally reviewed, and split into small stock-family issues.
- Preset Studio and QC Proof produce reviewable artifacts that make batch conversion decisions auditable.
- Roll cockpit, frame health grid, expert densitometer, base sampling studio, roll matching console, profile comparison matrix, and agent activity panels have UI designs and validation plans.
- WGPU/React sample overlays, frame boundaries, split views, and density readouts have coordinate-alignment tests before expert lab UI ships.
- Acquisition health, objective inversion, roll normalization, creative rendering, and output are separately inspectable and testable.
- Dedicated Negative Lab workflows are regression-tested from import through QC, positive variant creation, app-server dry-run, and export.
- The app-server agent cannot perform low-confidence calibration, destructive exports, unsafe profile imports, or broad batch operations without explicit dry-run evidence and user approval.
- Negative conversions are validated against color, black-and-white, ECN-2, slide-helper, dense/thin, mixed-roll, and multi-frame scan fixtures.

### Milestone 10: HDR Merge

Goal: produce editable high-quality HDR merge outputs.

Issues:

- Consult on HDR merge architecture.
  - See `docs/hdr/architecture-consult-summary-2026-06-14.md`.
- Audit existing RapidRAW HDR merge.
- Define HDR merge artifact schema.
- Add bracket detection.
- Add auto alignment tests.
- Add merge weighting strategy.
- Add deghosting strategy.
- Add HDR fixture set.
- Add merged output as editable source.
- Add HDR merge UI.
- Add HDR merge API tools.
- Add HDR merge performance tests.

Definition of done:

- User can merge bracketed RAWs into an editable high-dynamic-range result.
- The output enters the normal edit pipeline.
- Motion and alignment cases are validated.

### Milestone 11: Panorama Stitching

Goal: produce professional editable panorama outputs.

Issues:

- Consult on panorama architecture. Review captured in
  `docs/panorama/panorama-architecture-consult-2026-06-13.md`; follow-up
  issues added for schema hardening, engine adapter boundary, dry-run
  preflight, durable artifact persistence, and OpenCV backend evaluation.
- Harden artifact schema support invariants.
- Wrap current stitcher behind an adapter boundary.
- Add dry-run memory and geometry preflight.
- Persist editable derived panorama sources.
- Audit existing RapidRAW panorama stitcher. Initial audit captured in
  `docs/panorama/rapidraw-stitcher-audit-2026-06-13.md`.
- Define panorama artifact schema. Initial contract captured in
  `docs/panorama/panorama-artifact-schema-2026-06-13.md`.
- Add projection options. Initial contract captured in
  `docs/panorama/projection-options-2026-06-13.md`.
- Add auto crop/boundary controls. Initial contract captured in
  `docs/panorama/boundary-controls-2026-06-13.md`.
- Add exposure normalization. Initial contract captured in
  `docs/panorama/exposure-normalization-2026-06-13.md`.
- Add multi-row support audit. Initial audit captured in
  `docs/panorama/multi-row-support-audit-2026-06-13.md`.
- Add large panorama tiling strategy. Initial strategy captured in
  `docs/panorama/large-panorama-tiling-strategy-2026-06-13.md`.
- Persist editable derived panorama sources. Initial sidecar preservation
  contract captured in
  `docs/panorama/panorama-sidecar-artifact-persistence-2026-06-13.md`.
- Define backend capability contract. Initial contract captured in
  `docs/panorama/panorama-backend-capability-contract-2026-06-13.md`.
- Add panorama fixture set.
- Add panorama UI.
- Add panorama API tools.
  Initial app-server dry-run/apply tool contracts captured in
  `packages/rawengine-schema/samples/computational-merge-app-server-tool-manifest-v1.json`.
- Evaluate OpenCV stitching backend. Initial evaluation captured in
  `docs/panorama/opencv-backend-evaluation-2026-06-13.md`; recommendation is
  optional spike behind the panorama adapter, not a default dependency.
- Compare OpenCV seam and exposure strategies against the legacy engine.
  Initial comparison captured in
  `docs/panorama/opencv-seam-exposure-comparison-2026-06-13.md`.
- Document OpenCV macOS packaging and codesigning proof before promotion.
  Initial gate captured in
  `docs/panorama/opencv-macos-packaging-proof-2026-06-13.md`.
- Decide OpenCV required-CI promotion criteria. Initial policy captured in
  `docs/panorama/opencv-required-ci-promotion-2026-06-13.md`.
- Add panorama performance tests.
  Initial metadata-only gate captured in
  `docs/panorama/performance-validation-contract-2026-06-14.md`.

Definition of done:

- User can stitch RAW sequences into an editable panorama.
- Projection and boundary controls are available.
- Large files have bounded memory behavior.

### Milestone 12: Focus Stacking

Goal: support all-in-focus merges for macro/product workflows.

Issues:

- Consult on focus stacking architecture.
- Define focus stack artifact schema.
- Add alignment path.
- Add sharpness map generation.
- Add blending strategy.
- Add artifact retouch strategy.
- Add focus bracket fixture set.
- Add focus stack UI.
- Add focus stack API tools.
- Add focus stack performance tests.

Definition of done:

- User can create an editable focus stack merge.
- Stack artifacts can be inspected and corrected.
- Results are validated against macro/product fixtures.

### Milestone 13: Super-Resolution

Goal: support high-quality resolution enhancement without irresponsible hallucination.

Issues:

- Consult on super-resolution strategy.
- Define single-image vs multi-image modes.
- Define conservative/professional output policy.
- Add multi-image alignment path.
- Add detail reconstruction strategy.
- Add resolution chart fixtures.
- Add real photo fixtures.
- Add super-resolution UI.
- Add super-resolution API tools.
- Add performance tests.
- Add visual artifact review checklist.

Definition of done:

- User can create higher-resolution outputs from suitable input.
- Professional mode avoids hallucinated detail.
- Outputs are benchmarked against charts and real photos.

### Milestone 14: OpenAI App-Server Agent

Goal: make RawEngine controllable by a high-performance expert editing agent.

Issues:

- Consult on app-server architecture.
- Audit RapidRAW built-in AI features.
- Define provider abstraction for local, self-hosted, and cloud AI.
- Add app-server design doc.
- Add dynamic tool schema package.
- Add tool call validator.
- Add project/library tools.
- Add preview/histogram/scope tools.
- Add edit graph tools.
- Add tone/color tools.
- Add layer/mask tools.
- Add computational merge tools.
- Expose inherited AI mask tools through app-server tools where practical.
- Expose inherited AI enhancement tools through app-server tools where practical.
- Add AI provenance and provider metadata to sidecars/artifacts.
- Add approval gates for cloud AI and generative edits.
- Add export tools.
- Add approval boundaries.
- Add audit log.
- Add agent replay tests.
- Add AI tool schema and replay tests.
- Add unavailable-provider fallback tests.
- Add prompt injection test fixtures.
- Add agent demo workflow.

Definition of done:

- Agent can inspect an image, propose a plan, apply edits through tools, and show before/after output.
- Every agent operation is logged and replayable.
- Ambiguous or expensive actions require approval.

### Milestone 15: Professional Workflow Polish

Goal: make RawEngine feel like a polished working tool.

Issues:

- Add keyboard shortcut editor.
- Add command palette.
- Add compare/survey view.
- Add reference image workflow.
- Add export recipes UI.
- Add batch export queue.
- Add tethering research issue. Initial research captured in
  `docs/tethering/tethering-support-research-2026-06-14.md`.
- Add sessions workflow.
- Add smart albums/filters.
- Add import presets.
- Add metadata templates.
- Add custom workspace layouts.
- Add high-DPI visual QA.
- Add accessibility pass.
- Add onboarding sample project.

Definition of done:

- Common professional workflows are fast and coherent.
- UI polish is validated with screenshots and manual checklist.
- The editor feels like an app, not a tech demo.

### Milestone 16: Release Hardening

Goal: prepare credible public releases.

Issues:

- Add crash/error reporting strategy.
- Add privacy policy.
- Add telemetry opt-in decision.
- Add macOS signing plan.
- Add notarization workflow.
- Add update mechanism research.
- Add release notes automation. Initial script, workflow job, and validation
  captured in `docs/release/release-notes-automation-2026-06-13.md`.
- Add documentation site.
- Add user guide.
- Add developer API guide.
- Add sample agent guide.
- Add benchmark report.
- Add known limitations page.

Definition of done:

- A public macOS release artifact can be produced.
- Users can install, run, and understand limitations.
- Contributors can work from issues and docs.

## 13. Initial Issue Template

Each implementation issue should include:

```md
## Goal

What user-visible or engineering capability this issue adds.

## Milestone

The milestone this issue belongs to.

## Labels

Area, type, priority, PR size, risk, and validation labels.

## Blocked By

List dependencies, or `none`.

## Blocks

List follow-on issues, or `none`.

## PR Size Budget

Small, medium, or split-required. Explain why.

## Scope

What is included.

## Out Of Scope

What is intentionally deferred.

## Implementation Notes

Relevant code areas, docs, risks, or design constraints.

## Acceptance Criteria

- [ ] Concrete outcome 1
- [ ] Concrete outcome 2
- [ ] Concrete outcome 3

## Validation

- [ ] Exact local commands listed
- [ ] Tests added or updated
- [ ] Screenshots/artifacts added if UI or image output changed
- [ ] Validation evidence ledger completed
- [ ] CI green
- [ ] Skipped checks listed with reason

## Definition Of Done

Concrete completion criteria.
```

## 14. Initial PR Template

```md
## How

Describe the implementation approach.

## Why

Explain why this benefits RawEngine.

## Validation

- Linked issue:
- Local commands run:
- CI run:
- Required checks:
- Skipped checks and reason:
- UI screenshots:
- Image/render artifacts:
- Before/after comparison:
- Fixture/source manifest updates:

## Risk

Describe risky areas and rollback path.

## Plan Impact

- [ ] No plan update needed
- [ ] `RAW_EDITOR_PLAN.md` updated
- [ ] Follow-up issue created for plan drift
```

## 15. Autonomous Work Protocol

For implementation work, the agent should follow this protocol:

1. Confirm the active milestone and issue.
2. Read relevant code before proposing changes.
3. Use consult for high-risk design, UI workflow, color science, stitching, HDR, focus stacking, super-resolution, or app-server tool design.
4. Use Chrome plugin for internet sample image gathering and source/license verification when local testing needs external images.
5. Use image generation skill when artificial visual assets or controlled test imagery are useful.
6. Create or switch to a feature branch.
7. Make a small to medium scoped change.
8. Run local validation.
9. Attach artifacts for UI/image changes.
10. Open PR.
11. Watch CI.
12. Fix failures.
13. Keep issue/PR status updated.

Do not bypass protected `main`. Do not weaken gates to get a PR green unless the weakening itself is explicitly approved and tracked as technical debt.

## 16. Risk Register

### License Risk

RapidRAW is AGPL-3.0. A public fork is compatible with the user's intent, but RawEngine must keep source distribution and notices clean, including any networked app-server integration.

Mitigation:

- Add license audit.
- Track third-party dependency licenses.
- Avoid proprietary assets.
- Document AGPL obligations.

Dependency/license policy:

- Maintain an allow/deny/review list.
- Clearly compatible licenses can be allowed after review:
  - AGPL/GPL-compatible dependencies where appropriate.
  - MIT.
  - Apache-2.0.
  - BSD variants.
  - MPL-2.0 only after review.
- Require explicit review for:
  - GPL/AGPL boundary-sensitive libraries.
  - native binary dependencies.
  - model weights.
  - LUTs, ICCs, DCPs, film simulation assets.
  - AI services or SDKs.
  - font/icon/media assets.
- Forbid unless explicitly approved:
  - proprietary Capture One/Adobe assets.
  - copied competitor UI assets.
  - unlicensed film stock profiles.
  - sample images without usable license.
  - dependencies with unclear source availability.
- CI should fail on:
  - denied licenses.
  - unknown licenses after the allowlist is mature.
  - missing notices for bundled assets.
  - missing source/license metadata for fixtures.

### Scope Risk

The requested feature set is larger than most open RAW editors.

Mitigation:

- Use milestones.
- Keep PRs small/medium.
- Build validation before major feature work.
- Prioritize foundations before polish-heavy feature expansion.

### Color Science Risk

Professional color quality is difficult and easy to regress.

Mitigation:

- Create a documented color pipeline.
- Use measured fixtures.
- Add DeltaE/color chart tests.
- Use consult for color architecture.
- Keep CPU/GPU parity tests.

### Performance Risk

Layers, masks, HDR, panorama, and super-resolution can blow up memory and latency.

Mitigation:

- Add performance budgets.
- Use tiled processing for large outputs.
- Separate preview and final render paths.
- Track memory in CI/nightly tests.

### UI Complexity Risk

Professional features can make the UI ugly or overwhelming.

Mitigation:

- Keep a polished default surface.
- Move expert controls into advanced panels.
- Use progressive disclosure.
- Validate screenshots regularly.
- Use consult for workflow design.

### Agent Safety Risk

An agent that can edit images and files can make large unintended changes.

Mitigation:

- Make originals immutable.
- Require approvals for batch/export/delete/move/cloud operations.
- Log every tool call.
- Make edits undoable and replayable.
- Add prompt injection tests.

### Test Asset Risk

RAW files and sample photos may have licensing or size problems.

Mitigation:

- Maintain fixture manifest.
- Verify sources with Chrome when needed.
- Use Git LFS or download scripts.
- Prefer open and vendor-provided samples.

## 17. Implementation Sequence

Implementation is active. Historical bootstrap items are retained for context, and uncompleted items remain the early roadmap order:

1. Use the public `RapidRaw` fork as the project repository.
2. Create a feature branch with `codex/` prefix.
3. Open the first PR: add and establish this maintained PRD/technical plan as a documentation-only artifact.
4. Add minimal README, issue template, and PR template only if included in the approved first PR scope.
5. Merge the plan PR through review.
6. Add branch protection to `main`.
7. Add issue labels, templates, PR template, milestones, and initial issues if not already done in the first PR.
8. Fork RapidRAW publicly.
9. Clone the fork under `/Users/cgas/Documents/RawEngine/RapidRaw`.
10. Run the no-change RapidRAW baseline snapshot.
11. Audit RapidRAW scripts, lint config, TS config, Rust checks, and workflows.
12. Add Bun support.
13. Add strict lint/typecheck gates.
14. Add local hooks blocking `main`.
15. Add parallel GitHub Actions required checks.
16. Add baseline sidecar/render validation.
17. Only then begin feature work.

## 18. Open Decisions

These decisions are not blockers for this planning document, but they should become issues:

- Exact repository name: `RawEngine`, `rawengine`, or another public name.
- Whether to keep RapidRAW branding during early fork work or immediately rebrand.
- Hook tool choice: Lefthook, Husky, pre-commit, or custom scripts.
- Formatter choice if RapidRAW's current formatter is insufficient.
- Required platform matrix beyond macOS.
- Whether to require signed commits immediately.
- Whether to use Git LFS for fixtures from day one.
- Whether app-server runs in-process, as a sidecar process, or as a separate local service.
- Whether to use a catalog database immediately or start with sidecars/folders only.
- Which open sample RAW corpus to standardize on first.

## 19. Glossary

- API-first editing engine: the rule that UI, CLI, batch jobs, plugins, tests, and agent tools all mutate images through the same typed command layer.
- ArtifactNode: an edit graph node representing a derived output such as HDR merge, panorama, focus stack, or super-resolution result.
- Catalog: a searchable/indexed database for library workflow, previews, metadata, and collections. It should be rebuildable where practical.
- Command envelope: the versioned wrapper around an edit/API command, including actor, target, expected graph revision, parameters, dry-run, approval, and result.
- DerivedAsset: an editable output generated from one or more source assets through computational photography operations.
- Edit graph: the versioned non-destructive graph of RAW decode settings, operations, layers, masks, derived artifacts, and output transforms.
- Fixture manifest: a tracked record of test images and sample assets, including source URL, license, hash, metadata, and validation purpose.
- Graph revision: the version identifier used to detect concurrent or stale edits.
- Sidecar: portable edit-state file stored next to or associated with originals; source of truth for non-destructive edits when no catalog is present.
- Source asset: an original image or RAW file that RawEngine must not modify.
- Tool schema: strict JSON Schema or equivalent typed definition for an agent/API tool.
- Validation evidence ledger: the PR section that records exact commands, CI, artifacts, skipped checks, and residual risk.
