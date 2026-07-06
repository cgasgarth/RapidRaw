# RawEngine Agent Instructions

North star: `RAW_EDITOR_PLAN.md` drives a macOS-first, Capture One/Lightroom-class editor. Ship vertical product slices; planning, schemas, probes, inventories, reports, CI/tooling, and cleanup only support product work.

## Workflow

- Preflight each turn/worktree: repo root, branch/worktree, deps, remotes, GitHub repo, and PR queue. GitHub repo must be `cgasgarth/RapidRaw`; if not, run `bun run repo:fix-gh-resolution`. `origin` is the fork; `upstream` is `CyberTimon/RapidRAW`.
- Create worktrees with `bun run worktree:create -- --branch codex/name`; fix the helper if incomplete. Keep at most four active PRs; check queue before opening; enable auto-merge when safe; every PR gets merge, fix, close, or explicit deferral. Never push to protected `main`, stale PRs, or force-push healthy waiting PRs.
- If blocked, move another stream: implementation, validation, issue refinement, backlog, CI, or PR review. Main agent coordinates, delegates, reviews, decides, merges; keep two independent PR-bound streams active when feasible.

## Code Hygiene

- Use `apply_patch` for manual edits. Search repo-scoped with `rg` for text/files and `sg` for structure; bound `sed`/`head`/`tail`/`jq`; skip deps/build/cache unless needed. Use Bun for TS/React and one-off JS/TS; no Apple Events automation unless explicitly permitted.
- Keep TS/lint strict. No `as any` or `as unknown as`. Use Zod for TS-facing runtime schemas/config. Major or risky package bumps need dedicated issues.
- Avoid slop: no stray artifacts, helper indirection, generated inventory/report JSON, weak tests, workflow-string/command-name/metadata tests, agent-workflow files, or package/script bloat. No per-test/per-proof package aliases; scripts stay suite/workflow level. Prefer native tooling; keep `scripts/` for real helpers/generators/wrappers.

## Validation

- Before push/PR, stage intended files and commit so precommit runs; bypass only if user paused local validation, then say CI is the source. If GHA finds a deterministic repo failure, add the cheapest local gate unless already covered. Keep success tiny, failure actionable, and preserve evidence: commands, blockers, runtime proof, consult decisions.
- Match proof to claim: plan-only, schema-only, API-only, dry-run-only, UI-only, and runtime-capable are distinct. Do not call features complete without runtime, preview/export, E2E/equivalent proof, screenshots/artifacts, and tracked gaps.
- Image features require app execution on RAWs and output validation, preferably `/Users/cgas/Pictures/Capture One/Alaska`. Never commit private RAWs/artifacts; use one private-root/report pattern. Use Computer Use for visible UI claims and `bun run install:computer-use` for the app bundle.
- README/docs marketing media must use current UI captures without people in images, GIFs, filmstrips, thumbnails, previews, or generated assets; use landscapes, objects, synthetic fixtures, or clearly licensed/repo-owned assets instead, and do not introduce people in new README/docs images or GIFs.

## Issues, Consult, CI

- Issues map to one realistic PR and include concise Why, How, Validation, constraints, links/artifacts, runtime proof needs, and plan-only status when relevant. Use milestones for themes; split broad issues and close stale, duplicate, or meta-only ones.
- Use consult at milestone level before creating/reshaping milestones; ask for architecture, sequence, risks, validation, and PR-sized issues, passing milestone titles/numbers and GitHub data when available. Reconsult per PR only when scope/risk changes. Use consult heavily for UI, color science, negative processing, film sims, deblur/denoise/detail math, panorama, HDR, focus stacking, super-resolution, app-server agents, GHA, and hard decisions. RapidRaw consults belong in the RapidRaw ChatGPT project.
- Use Bun test for non-UI TS, Playwright/native app automation for UI/E2E, and Cargo test for Rust. Maintain `PR CI / required`, supported GitHub Actions versions, and non-canceling PR/main workflow runs.
