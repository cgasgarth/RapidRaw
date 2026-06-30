# Mask Refinement Command

- Issue: #1258 `api(commands): expose mask refinement as typed edit command`
- Schema: `LayerMaskCommandEnvelopeV1`
- Command: `layerMask.refineMask`
- Sample: `packages/rawengine-schema/samples/layer-mask-refine-command-envelope-v1.json`

## Scope

The layer/mask command schema now exposes the renderer-backed refinement fields
used by the masks panel and Rust mask renderer:

- `density`
- `featherPx`
- `edgeShiftPx`
- `edgeContrast`
- `smoothness`

The command validates the same numeric bounds as the renderer contract where
practical. This gives UI, CLI, app-server tools, and future command replay work a
typed path for the mask refinement controls.

## Status

This is a schema and sample command surface. It does not yet route the live React
UI through the command bus, apply the command to the in-memory store, or prove
preview/export parity. Those remain follow-up implementation issues.
