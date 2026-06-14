# ColorChecker Fixture Manifest

- Issue: #88 `validation(color): add ColorChecker fixture set`
- Scope: metadata-only fixture manifest and Zod validation; no real chart images,
  rendered pixels, or DeltaE quality claims.

## Purpose

Color pipeline work needs a stable manifest before real ColorChecker captures,
synthetic patch renders, DeltaE baselines, and CPU/GPU parity tests land. This
manifest defines the first fixture IDs, provenance requirements, patch geometry,
measurement basis, and validation uses without committing any external asset.

## Manifest

The manifest lives at:

- `fixtures/color/colorchecker-fixture-manifest.json`

It currently contains:

- `colorchecker.synthetic.acescg-neutral-ramp.v1`
- `colorchecker.raw.camera-profile-baseline.v1`

Both fixtures are metadata-only. Active image assets must add source/provenance,
hashes, measurement basis, and license evidence before the checker allows
`active_asset`.

## Validation

Run:

```sh
bun run check:colorchecker-fixtures
```

The checker validates:

- fixture ID format and uniqueness;
- required fixture IDs;
- patch grid dimensions matching expected patch count;
- measurement metadata;
- license/provenance evidence;
- active assets requiring `sha256:` hashes;
- metadata-only fixtures not claiming active asset status.

This does not replace DeltaE measurement, ColorChecker patch extraction,
camera-profile transform tests, preview/export parity, or CPU/GPU parity.

## Validation Evidence

- `bun run check:colorchecker-fixtures`
- `bun run check:unsafe-casts`
- `bunx prettier --check scripts/check-colorchecker-fixtures.mjs fixtures/color/colorchecker-fixture-manifest.json docs/color/colorchecker-fixtures-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun scripts/check-markdown-links.mjs`
- `git diff --check`
