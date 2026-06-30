# Negative Lab App-Server Tool Contract

- Date: 2026-06-13
- Issue: #270 `agent(negative-lab): expose safe app-server tools for negative lab`
- Scope: typed app-server tool manifest for Negative Lab dry-run and apply
  boundaries.

## Purpose

Negative Lab app-server work starts with a narrow manifest before runtime tool
handlers are wired. The manifest is local-first and defines exactly which tool
names, input schemas, output schemas, command families, mutation behavior, and
dry-run requirements are valid for the OpenAI app-server adapter.

The checked sample artifact is:

```text
packages/rawengine-schema/samples/negative-lab/workflows/negative-lab-app-server-tool-manifest-v1.json
```

## Tool Boundary

| Tool                                | Mode                 | Input                           | Output                      | Mutates | Dry-run plan | Provenance |
| ----------------------------------- | -------------------- | ------------------------------- | --------------------------- | ------- | ------------ | ---------- |
| `negativelab.preview_conversion`    | `dry_run_command`    | `NegativeLabCommandEnvelopeV1`  | `NegativeLabDryRunResultV1` | No      | Creates one  | Yes        |
| `negativelab.apply_planned_command` | `apply_dry_run_plan` | `NegativeLabApplyPlanRequestV1` | `NegativeLabApplyResultV1`  | Yes     | Requires one | Yes        |

The preview tool accepts the Negative Lab command union and returns a dry-run
plan plus preview artifacts. The apply tool never accepts free-form command
parameters directly; it applies a previously generated dry-run plan and records
the command id, expected session revision, acknowledged warnings, and result
provenance.

## Contract Rules

- Dry-run tools must not mutate project state.
- Apply tools must be marked mutating and must require a prior dry-run plan.
- Mutating tools must use `edit_apply` approval class.
- Tools that mutate or return artifacts must record provenance.
- Runtime adapters must preserve `commandId`, `correlationId`, and warning
  acknowledgements across dry-run and apply calls.
- Tool JSON returns artifact handles rather than embedding full raster payloads.
- v1 Negative Lab app-server commands support only C-41 color negatives and
  black-and-white silver negatives; deferred process families remain metadata
  only until dedicated validation and presets land.

## Validation

Run:

```sh
bun run schema:check
```

This validates the manifest sample and rejected cases for unsafe mutation
contracts. Runtime adapter PRs should add replay fixtures before connecting
these contracts to image state, sidecars, or the app-server transport.
