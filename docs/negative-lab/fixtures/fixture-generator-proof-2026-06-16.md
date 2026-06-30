# Negative Lab Fixture Generator Proof

- Date: 2026-06-16
- Issue: #1377 `negative-lab(validation): fixture acquisition and synthetic generator proof`
- Status: implementation scaffold
- Validation: `bun run check:negative-lab-fixtures`

## Scope

This adds a deterministic fixture proof before claiming conversion quality. The
fixture set is generator-owned metadata and small synthetic RGB references, not
a measured film-stock profile or pixel-golden image suite.

## Artifacts

- `fixtures/negative-lab/negative-lab-fixture-manifest.json`
- `fixtures/negative-lab/negative-lab-synthetic-fixture-proof.json`
- `tests/integration/checks/negative-lab/check-negative-lab-fixtures.ts`

## Coverage

The generator records:

- known-positive gray ramp samples with base/fog;
- known-positive color ramp samples with exposure-offset metadata;
- missing base/fog sample failure mode;
- dense/thin exposure-offset failure mode;
- clipped base channel failure mode;
- unknown acquisition profile failure mode;
- a metadata-only camera-scanned RAW candidate that remains private until
  licensing and ownership review permits fixture use.

## Guardrails

The check validates the Zod-backed `NegativeLabFixtureManifestV1` contract,
synthetic proof schema, deterministic SHA-256 hashes, required failure-mode
coverage, and presence of a private camera RAW candidate. It intentionally does
not set quality thresholds, DeltaE thresholds, or named film-stock claims.
