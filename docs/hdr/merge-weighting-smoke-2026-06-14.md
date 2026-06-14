# HDR Merge Weighting Smoke

Issue: #167 `hdr(merge): add merge weighting strategy`
Status: deterministic synthetic exposure-weighting smoke; not a final RAW merge
renderer.

## Scope

This validation proves the first HDR merge weighting invariant with generated
linear radiance data:

- render three synthetic brackets at -2 EV, 0 EV, and +2 EV;
- merge by down-weighting clipped and badly exposed pixels;
- reconstruct scene-linear radiance; and
- report highlight recovery metrics.

It does not decode RAW files, align shifted brackets, deghost motion, write
sidecars, or produce user-visible HDR output.

## Required Metrics

- Recovered highlight pixel ratio: at least 0.9.
- Unrecovered clipped pixel ratio: at most 0.03.
- Mean absolute reconstruction error: at most 0.015.
- Per-source clipped and near-clipped ratios are emitted in the JSON summary.

## Validation

Run:

```sh
bun run check:hdr-merge-weighting-smoke
```
