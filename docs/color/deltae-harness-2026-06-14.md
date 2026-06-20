# DeltaE Harness

- Issue: #89 `validation(color): add DeltaE measurement harness`
- Scope: CIEDE2000 math and reference fixture validation only; no image patch
  extraction, rendered ColorChecker output, or product color-quality claim.

## Purpose

Color pipeline PRs need a deterministic DeltaE checker before real ColorChecker
patch extraction and measured RAW fixtures can become gates. This harness adds a
small CIEDE2000 implementation and published synthetic Lab reference pairs so
future color changes can prove numeric regressions before claiming visual
quality.

## Fixtures

Reference fixtures live at:

- `fixtures/color/deltae-reference-fixtures.json`

They include:

- an identity neutral pair that must return zero;
- three blue-region CIEDE2000 reference pairs from the standard validation set.

## Validation

Run:

```sh
bun run check:deltae-fixtures
```

The checker validates:

- fixture schema and unique IDs;
- required reference fixtures;
- CIEDE2000 output against expected values;
- per-fixture tolerances.

This is a math harness only. Real rendered ColorChecker gates still need patch
geometry extraction, reference target metadata, camera/profile transforms,
preview/export parity, and CPU/GPU parity.

## Validation Evidence

- `bun run check:deltae-fixtures`
- `bun run check:colorchecker-fixtures`
- `bun run check:unsafe-casts`
- `bunx prettier --check tests/integration/checks/check-deltae-fixtures.ts fixtures/color/deltae-reference-fixtures.json docs/color/deltae-harness-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
