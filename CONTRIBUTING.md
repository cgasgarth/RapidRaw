# Contributing To This Fork

This fork is driven by `RAW_EDITOR_PLAN.md`.

Before opening implementation work:

- Link the GitHub issue the PR closes.
- Keep the PR small to medium sized.
- Update `RAW_EDITOR_PLAN.md` when product scope, architecture, validation policy, or execution order changes.
- Preserve AGPL/public-source obligations and upstream notices.
- Do not commit directly to `main`.
- Do not weaken required checks without a tracked issue and explicit rationale.

Every PR should include validation evidence:

- exact local commands run.
- CI result or pending/skipped-check rationale.
- screenshots for UI changes.
- render artifacts for image-processing changes.
- fixture/license manifest updates when sample images are involved.
- residual risk and follow-up issues.

The first source of truth is the maintained plan, then linked GitHub issues and ADRs.
