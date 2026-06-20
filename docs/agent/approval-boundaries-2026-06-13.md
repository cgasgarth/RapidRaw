# Agent Approval Boundaries

RawEngine app-server tools must keep read, preview, dry-run, apply, export, and
background job boundaries explicit. The approval model is part of the tool
contract, not only UI copy, because agents can invoke editing surfaces through
schema-validated tool calls.

## Boundary Rules

- Read tools use `safe_read`, do not mutate state, and do not require approval.
- Preview tools use `preview_only`, do not mutate state, and may return temporary
  artifacts.
- Dry-run editing tools use `preview_only` or `external_model`, do not mutate
  state, and create plans or artifacts that must be accepted before apply.
- Apply tools mutate state and must use an apply-class approval such as
  `edit_apply`, `file_mutation`, `batch_apply`, or `generative_edit`.
- AI dry-run tools that inspect pixels through a model use `external_model`.
- AI apply tools that commit generated masks or pixels use `generative_edit` and
  require an approved state.
- App-server tools that apply a dry-run plan must require the prior plan and must
  record provenance.

## Shift-Left Check

`tests/integration/checks/check-agent-approval-boundaries.ts` parses the generated schema sample
artifacts with the Zod schemas in `packages/rawengine-schema/`, then validates:

- registry tool definitions in `tool-registry-v1.json`;
- app-server tool manifests for AI and Negative Lab tools;
- app-server tool-call validation fixtures;
- agent replay fixtures.

The check fails if mutating tools use non-mutating approval classes, dry-run or
read tools are marked mutating, app-server apply tools do not require accepted
dry-run plans, mutating calls lack approved state, or replay steps drift from the
approval boundary expected by their mutation behavior.

This script is intentionally standalone while dependency/update PRs own
`package.json`. Once that queue settles, wire it into the normal validation
entrypoint so approval regressions fail before CI.
