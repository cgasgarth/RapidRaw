# Focus Stack API Tool Contract

- Issue: #194 `api(focus): add focus stack API tools`
- Scope: schema-backed command samples and OpenAI app-server tool manifest entries
- Runtime status: contract only; renderer, UI wiring, and app-server transport handlers are follow-up work

## Purpose

Focus stacking must be available through the same typed command path as UI and
agent workflows. This contract exposes focus stack creation as a local-only
computational merge tool pair:

- `computationalmerge.focus_stack.dry_run_command`
- `computationalmerge.focus_stack.apply_command`

Both tools use `ComputationalMergeCommandEnvelopeV1` as input. Dry-run returns
`ComputationalMergeDryRunResultV1`; apply returns
`ComputationalMergeMutationResultV1`.

## Command Boundary

The command type is `computationalMerge.createFocusStack`.

Required focus parameters:

- `sources`: at least two `focus_slice` source image references.
- `alignmentMode`: alignment strategy for focus-bracketed frames.
- `blendMethod`: `depth_map`, `laplacian_pyramid`, or `weighted_sharpness`.
- `retouchLayerPolicy`: whether to generate a retouch layer for stack artifacts.
- `qualityPreference`: preview, balanced, or best.
- `maxPreviewDimensionPx`: bounded preview sizing for resource control.
- `outputName`: durable derived asset name.

Apply commands must include an accepted dry-run plan id and hash. This keeps
agent and batch workflows from mutating the edit graph without a prior reviewed
plan.

## App-Server Safety

Focus stack tools are local-only because source RAW access, project state, and
derived artifacts live on the user's machine.

Dry-run behavior:

- approval class: `preview_only`
- mutates: `false`
- requires prior dry-run plan: `false`
- records provenance: `true`
- returns artifact handles: `true`

Apply behavior:

- approval class: `edit_apply`
- mutates: `true`
- requires prior dry-run plan: `true`
- records provenance: `true`
- returns artifact handles: `true`

## Sample Artifacts

Schema samples added or updated by this contract:

- `packages/rawengine-schema/samples/focus-stack/computational-merge-focus-stack-command-envelope-v1.json`
- `packages/rawengine-schema/samples/focus-stack/computational-merge-focus-stack-apply-command-envelope-v1.json`
- `packages/rawengine-schema/samples/focus-stack/computational-merge-focus-stack-dry-run-app-server-tool-call-validation-v1.json`
- `packages/rawengine-schema/samples/focus-stack/computational-merge-focus-stack-apply-app-server-tool-call-validation-v1.json`
- `packages/rawengine-schema/samples/computational-merge/computational-merge-app-server-tool-manifest-v1.json`
- `packages/rawengine-schema/samples/core/tool-registry-v1.json`

## Validation

The contract is validated by:

- `bun run schema:check`
- `bun run check:unsafe-casts`
- `bun run format:check`
- `git diff --check`

## Follow-Ups

- Bind these contracts to app-server transport handlers.
- Add focus-stack dry-run and apply replay tests once the command bus executes
  computational merge commands.
- Add renderer-backed validation that proves dry-run focus coverage, sharpness
  map output, blend output, and retouch artifacts match the command contract.
