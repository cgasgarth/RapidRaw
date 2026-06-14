# Focus Stack Architecture Consult Summary

- Issue: #186 `consult(focus-stack): get focus stacking architecture review`
- Scope: Milestone 12 architecture review
- Source: RapidRaw ChatGPT project consult with GitHub repo context attached
- Status: contract and implementation-order review; no renderer-quality claim

## Current State Reviewed

- Artifact schema: #187
- Alignment path: #188
- Sharpness map strategy: #189
- Blend strategy: #190
- Retouch strategy: #191
- Fixture manifest: #192
- API tools: #194
- Performance contract: #195
- Plan-only UI surface: #193

## Accepted Architecture

Focus stacking should stay on the typed computational merge path rather than a
separate renderer shortcut. The accepted shape is:

- `computationalMerge.createFocusStack` command envelopes for dry-run and apply.
- Local-only app-server tool definitions that route through the command layer.
- Dry-run before apply, with accepted plan id and hash required for mutation.
- Derived artifact provenance for source refs, source hashes, graph revisions,
  dry-run plan id/hash, backend/version, warning codes, block codes, validation
  metrics, and output artifact handles.
- Retouch layers treated as first-class non-destructive artifacts rather than
  hidden baked output.
- Conservative deterministic CPU runtime proof before GPU, local warp, or
  depth-map apply behavior.

## Gaps Found

- Add a focus-specific RAW normalization and color policy before sharpness maps
  consume decoded image data.
- Add a plan-only runtime dry-run preflight before alignment, sharpness, or blend
  output claims.
- Use generated deterministic fixtures before real RAW decode fixtures so the
  first runtime proof is small, stable, and CI-friendly.
- Treat focus confidence maps as source-winner/confidence proxies, not metric
  depth maps, until real fixture validation supports stronger claims.
- Keep `depth_map` blend gated until confidence/depth proxy behavior is proven
  across real fixtures.
- Keep memory budget estimates and observed peak memory in the focus validation
  path because full-resolution RAW slices plus map artifacts can exceed macOS
  memory quickly.

## Recommended Implementation Order

1. Schema hardening and issue tracking.
2. RAW normalization and color policy.
3. Plan-only dry-run preflight.
4. Tiny synthetic focus-bracket fixture generator.
5. CPU translation alignment smoke.
6. CPU sharpness-map smoke.
7. CPU weighted-sharpness preview blend smoke.
8. UI dry-run review with warnings, block reasons, memory/runtime estimates, and
   preview artifact references.
9. Real macro/product fixture validation.
10. App-server transport binding through the typed command bus.

## Validation Gates

Tier 0 schema and contract validation:

- `bun run schema:check`
- `bun run check:unsafe-casts`
- `bun run format:check`
- `git diff --check`

Tier 1 deterministic runtime smoke:

- Three generated sources.
- 512 px or smaller long edge.
- Known foreground, midground, and background winner regions.
- Optional translation and focus-breathing variants.
- Target runtime under 10 seconds.
- Peak memory under 1 GB.

Tier 2 real macro/product review:

- Printed labels or product text.
- High-frequency product texture.
- Specular transitions.
- Five to twelve slices.
- Shallow depth of field.

Tier 3 natural texture and parallax stress:

- Foliage, bark, fabric, or hair.
- Low-contrast texture.
- Optional high-ISO variant.
- Foreground/background parallax.
- Slight camera movement or unstable detail.

## Risk Register

| Risk                                        | Impact                                                                                      | Mitigation                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| False sharpness or invented apparent detail | Professional trust failure for macro/product outputs.                                       | Conservative focus measure, no neural synthesis, visual crops, warning/block codes, and retouch seeds.                              |
| RAW normalization mismatch                  | Focus maps choose slices from exposure, white balance, clipping, or noise instead of focus. | Same RAW defaults, linear luminance policy, exposure/WB policy, saturation handling, and noise penalties.                           |
| Focus breathing and parallax                | Doubled edges, texture tearing, or distorted product labels.                                | Translation first, constrained scale correction later, homography only with enough coverage, and no local warp until fixtures pass. |
| Non-destructive provenance gap              | Derived stacks cannot be invalidated or audited after source edits.                         | Source hashes, graph revisions, dry-run plan hash, stale reasons, and artifact handles.                                             |
| Retouch hidden too late                     | Users export stacks with unreviewed artifacts.                                              | Retouch-required warnings before apply/export, region list, review state, and source-candidate provenance.                          |
| Depth-map overclaiming                      | UI implies real depth when data is only focus confidence.                                   | Use confidence/source-map wording until validated and keep `depth_map` gated.                                                       |
| Memory blowups                              | Many full-resolution RAW slices and maps exceed local memory.                               | Tiered validation, preview limits, later streaming/tiling, and dry-run memory budgets.                                              |
| App-server overreach                        | Agent applies a flawed stack without review.                                                | Local-only tools, dry-run first, explicit approval, block/warning payloads, and replay tests.                                       |

## Follow-Up Issues

- #1057 `docs(focus): define RAW normalization and color policy`
- #1058 `focus(runtime): add plan-only dry-run preflight`
- #1059 `validation(focus): add tiny synthetic bracket generator`
- #1060 `focus(runtime): add CPU translation alignment smoke`
- #1061 `focus(runtime): add CPU sharpness-map smoke`
- #1062 `focus(runtime): add weighted-sharpness preview blend smoke`
- #1063 `agent(focus): bind app-server focus tools to command bus`

## Decision

The first runtime proof should use generated RGB or linear fixtures before
touching RAW decode. That keeps the first runtime PR deterministic, small, and
suited to CI. Real RAW fixture validation remains required before final user
claims about focus-stack image quality.
