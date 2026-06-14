# Super-Resolution Strategy Consult Summary

Date: 2026-06-14
Scope: GitHub issue #196, super-resolution strategy review

## Consult Inputs

The consult reviewed the current RawEngine/RapidRaw super-resolution plan, the
existing `computationalMerge.createSuperResolution` command envelope, the
plan-only UI work, the aggressive-preview apply guard, and the app-server tool
requirements for future agent-driven editing.

## Accepted Direction

- Keep the implementation schema-first until runtime alignment and synthesis are
  ready. Do not imply that a backend can generate final SR output before the
  renderer exists.
- Keep SR inside the computational merge family. Avoid introducing separate
  `sr.*` command envelopes while the existing merge command/result model already
  covers dry-run, apply, source refs, graph revisions, and artifacts.
- Add SR-specific app-server tool names for agent use, but keep them local-only
  and validation-only until handlers can return honest dry-run/apply results.
- Require a dry-run/apply split: dry-run can produce preview artifacts and
  policy decisions; apply must require user approval plus accepted dry-run plan
  ID and hash.
- Treat aggressive detail as preview-only. Professional final apply must fail
  closed when detail would be hallucinated, unverifiable, or missing provenance.
- Require final SR outputs to be derived artifacts with source references,
  content hashes, source graph revisions, selected scale/detail/alignment
  settings, engine/model provenance, stale-state rules, and validation summary.
- Prefer conservative multi-image reconstruction by default. Any model-backed or
  generated-detail path needs explicit mode, model provenance, warnings, and
  review status.

## Implemented Follow-Through

- PR #1034 added schema-first SR app-server tool contracts, SR-specific tool
  names, local-only/provenance manifest validation, and apply guardrails.
- PR #1036 adds SR dry-run summary and derived artifact provenance contracts,
  including warning/block decisions, source state, stale-state invalidation, and
  model provenance rules.

## Deferred Work

- Runtime alignment, synthesis, preview generation, sidecar writes, and UI apply
  remain out of scope for these schema PRs.
- Dedicated quality validation fixtures should be implemented through separate
  issues for visual artifact review, performance, and real-photo/chart evidence.
- Naming alignment between user-facing `standard` wording and schema-level
  `balanced` should be handled as a deliberate migration issue if the product
  vocabulary changes.

## Validation Policy

Each SR implementation PR should include the narrowest relevant local checks.
For schema-only work, require:

- `bun run schema:check`
- `bun run check:unsafe-casts`
- `bun run format:check`
- `bun run check:lint`
- `git diff --check`

Runtime PRs must add image-processing validation evidence before claiming image
quality, including chart fixtures, real-photo crops, 100 percent and 200 percent
comparisons, artifact notes, source manifest, output dimensions, and timing or
memory observations when runtime measurement exists.
