# Camera Profile Lookup Fixtures

`bun run check:camera-profile-lookup` validates the first camera-profile lookup
fixture set for RawEngine color pipeline work.

The fixture covers:

- exact camera model lookup;
- camera model alias lookup;
- case-insensitive manufacturer and file extension handling;
- DNG embedded-matrix fallback;
- generic raw-decoder fallback with a stable warning.

## Runtime Proof Slice

Issue #1261 adds `bun run check:camera-profile-input-transform`, which validates
one executable camera-profile/input-transform slice with synthetic chart pixels.
The gate looks up the selected profile, applies the declared 3x3
camera-to-working matrix, checks output RGB deltas, and writes the artifact
report:

`docs/validation/proofs/color/camera-profile-input-transform-proof-2026-06-18.json`

This is a headless transform proof, not a full RAW decoder or preview/export
parity claim. Real camera chart captures, measured profile quality, and full
render-path parity remain follow-up work.
