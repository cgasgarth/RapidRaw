# RawEngine Agent Instructions

North star: `RAW_EDITOR_PLAN.md` defines the goal: macOS-first, Capture One/Lightroom-class, vertical product delivery.

## Mission

- Prefer feature PRs. Planning, schemas, probes, inventories, reports, CI/tooling, and cleanup only support product work; they must not outnumber feature progress or become standalone churn.
- If blocked, keep moving on another stream: implementation, validation, issue refinement, backlog care, CI diagnosis, or PR review.
- Remove slop before publishing: stray artifacts, helper indirection, generated inventory/report JSON, weak tests, script bloat, agent-workflow files, or anything a reviewer would ask "why is this here?"
- Keep output compact. Success gets a short summary; failure gets failing step, bounded excerpt, and next action. Preserve validation commands, blockers, runtime proof, and accepted/rejected consult advice.

## Repo And PRs

- Preflight each new turn/worktree: repo root, branch/worktree, deps, remotes, GitHub repo, open PR count. Fix failures first.
- `gh repo view --json nameWithOwner --jq .nameWithOwner` must be `cgasgarth/RapidRaw`; otherwise run `bun run repo:fix-gh-resolution`. `origin` is the fork; `upstream` is `CyberTimon/RapidRAW`.
- Create worktrees with `bun run worktree:create -- --branch codex/name`; fix the helper if setup is incomplete.
- Keep at most four active PRs. Check the queue before opening one. Every PR needs merge, fix, close, or explicit deferral. Do not let PRs stale, force-push healthy waiting PRs, or push to protected `main`. Enable auto-merge when safe.

## Code And Tooling

- Use `apply_patch` for manual edits. Use Bun for TS/React work. Search repo-scoped with `rg` for text/files, `sg` for structure, bounded `sed`/`head`/`tail`/`jq`; skip deps/build/cache unless needed.
- No Apple Events automation (`osascript`, System Events, JavaScript from Apple Events) unless explicitly permitted.
- No per-test/per-proof `package.json` aliases. Scripts stay suite/workflow level: `test`, `check`, `lint`, `format`, `build`, schema/bundle/Rust gates, app launchers, and worktree setup. Run individual checks directly.
- Prefer native tooling over custom scripts. Delete metadata-only tests, workflow-string tests, command-name tests, generated inventories, and weak `tests/integration/checks/check-*.ts` files.
- Use Bun test for non-UI TS, Playwright or native app automation for UI/E2E, and Cargo test for Rust. Keep `scripts/` for real helpers/generators/wrappers.
- Keep TS/lint strict. No `as any` or `as unknown as`. Use Zod for TS-facing runtime schemas/config. Major or risky package bumps need dedicated issues.

## Validation

- Before push/PR, stage intended files and try the commit so precommit runs; fix and retry. Bypass only if the user paused local validation, then say CI is the source.
- If GHA finds a deterministic repo failure, add the cheapest local gate unless already covered. Keep success output tiny and failure output actionable.
- Match proof to claim: plan-only, schema-only, API-only, dry-run-only, UI-only, and runtime-capable are different. Do not call features complete without runtime, preview/export, E2E/equivalent proof, screenshots/artifacts, and tracked gaps.
- Image features require app execution on RAWs and output validation, preferably `/Users/cgas/Pictures/Capture One/Alaska`. Never commit private RAWs/artifacts. Use one private-root/report pattern. Use Computer Use for visible UI claims and `bun run install:computer-use` for the app bundle.

## Issues, Consult, And Delegation

- Issues should map to one realistic PR and include concise Why, How, Validation, constraints, links/artifacts, runtime proof needs, and plan-only status when relevant. Use milestones for themes; split broad issues and close stale, duplicate, or meta-only ones.
- Use consult at milestone level before creating or reshaping milestones. Ask for architecture, sequence, risks, validation, and PR-sized issues; pass milestone titles/numbers and use the GitHub connector when available. Reconsult per PR only when scope/risk changes.
- Use consult heavily for UI, color science, negative processing, film sims, deblur/denoise/detail math, panorama, HDR, focus stacking, super-resolution, app-server agents, GHA, and hard decisions. RapidRaw consults belong in the RapidRaw ChatGPT project with `cgasgarth/RapidRaw` data when available.
- Main agent is engineering manager: select work, delegate, review, decide, merge. Keep at least two independent PR-bound streams active when feasible. Subagents/worktrees can handle implementation, validation, CI diagnosis, issue refinement, backlog cleanup, polling, and PR monitoring. Accept no feature as complete without runtime/product proof.

## CI

- Maintain the stable `PR CI / required` aggregate gate and supported GitHub Actions versions. New `main` or PR workflow runs should not cancel older runs.
