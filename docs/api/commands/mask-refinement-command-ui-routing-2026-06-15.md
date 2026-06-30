# Mask Refinement UI Command Routing

- Issue: #79 `api(commands): route representative UI operations through command bus`
- UI path: masks panel refinement controls
- Command: `layerMask.refineMask`
- Validation: `tests/integration/checks/masks/check-mask-refinement-command-ui.ts`

## Scope

Mask refinement sliders now build and dispatch a typed `layerMask.refineMask`
command before updating selected submask parameters. This makes the refinement UI
the first representative editor operation routed through a command-shaped
validation path instead of directly applying an untyped parameter patch.

## Status

This is an in-process UI command routing slice. It does not yet use the schema
package command bus from app runtime, persist command history, replay through the
edit graph, or call Tauri. Those remain follow-up issues for full command-bus
coverage.
