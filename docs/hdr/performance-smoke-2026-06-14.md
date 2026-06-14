# HDR Performance Smoke

Issue: #173 `validation(hdr): add HDR performance tests`
Status: deterministic smoke performance gate; not a full RAW benchmark.

## Scope

This gate runs the small HDR runtime validation scripts and fails if any case
regresses beyond its smoke budget:

- HDR alignment smoke.
- HDR merge weighting smoke.
- HDR deghosting smoke.

It does not measure full-resolution RAW decode, tiled rendering, GPU kernels,
sidecar writes, or real bracket quality.

## Budgets

Each deterministic smoke must complete within 2500 ms on a normal local or CI
runner.

## Validation

Run:

```sh
bun run check:hdr-performance-smoke
```
