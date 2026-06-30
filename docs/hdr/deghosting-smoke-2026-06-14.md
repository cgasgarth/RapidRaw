# HDR Deghosting Smoke

Issue: #168 `hdr(deghost): add deghosting strategy`
Status: deterministic synthetic motion-mask smoke; not a final deghosting
renderer.

## Scope

This validation creates three generated bracket-style frames with a moving bright
object and verifies that a motion mask can:

- detect the moving regions;
- preserve a selected reference frame inside those regions; and
- report precision, recall, motion coverage, and residual ghost error.

It does not decode RAW files, align real images, blend exposure radiance, or
write durable mask artifacts.

## Required Metrics

- Motion-mask recall: at least 0.95.
- Motion-mask precision: at least 0.9.
- Motion-region ghost mean absolute error: at most 0.01.

## Validation

Run:

```sh
bun run check:hdr-deghosting-smoke
```

## Artifact Gate Follow-Up

Issue #1928 adds `bun run check:hdr-deghost-tone-artifact`, which records
semantic deghost mask/output hashes plus scene-linear and tone-mapped preview
hashes for the synthetic HDR gate. The report lives at
`docs/validation/proofs/hdr/hdr-deghost-tone-artifact-proof-2026-06-18.json`.
