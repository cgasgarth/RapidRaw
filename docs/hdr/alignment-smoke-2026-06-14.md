# HDR Alignment Smoke

Issue: #166 `hdr(align): add auto alignment tests`
Status: deterministic synthetic translation smoke; not a final RAW-quality
claim.

## Scope

This validation adds a tiny generated HDR alignment fixture and proves the
alignment scorer can recover integer translations against a known reference.

The smoke does not decode RAW files, estimate homographies, evaluate optical
flow, or validate deghosting. It is the first CI-friendly runtime proof before
larger bracket and real RAW fixtures are introduced.

## Fixture

- 64 x 48 synthetic luminance reference.
- Three bracket-style sources.
- Known shifts: `(2, -1)`, `(0, 0)`, and `(-3, 2)`.
- Exhaustive translation search radius: 5 px.
- Required overlap ratio: 0.75.
- Required translation error: 0 px.
- Required RMS error: 0.000001 or lower.

## Validation

Run:

```sh
bun run check:hdr-alignment-smoke
```

The script emits a JSON summary with the reference source, recovered transforms,
overlap ratio, RMS error, and alignment confidence.

## Bracket Gate Follow-Up

Issue #1927 adds `bun run check:hdr-alignment-bracket-proof`, which combines the
fixture manifest bracket detector with deterministic alignment recovery and a
duplicate-exposure rejection proof. The generated report lives at
`docs/validation/proofs/hdr/hdr-alignment-bracket-proof-2026-06-18.json`.
