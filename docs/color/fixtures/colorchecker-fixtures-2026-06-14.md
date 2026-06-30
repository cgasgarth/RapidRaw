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
- `docs/validation/fixtures/public-fixture-manifest.json`
- `fixtures/detail/private-raw-evidence-ledger.json`

It currently contains:

- `colorchecker.synthetic.acescg-neutral-ramp.v1`
- `colorchecker.raw.camera-profile-baseline.v1`
- `real.color.camera-profile-colorchecker.v0`
- `real.color.camera-profile-skin-chart.v0`
- `raw-evidence.color.camera-profile-chart.v1`

Both fixtures are metadata-only. Active image assets must add source/provenance,
hashes, measurement basis, and license evidence before the checker allows
`active_asset`.

The camera-profile RAW corpus entries are placeholders for issue #1895. They
reserve public manifest IDs and one private evidence ledger slot, but they do
not add RAW payloads, commit target reference images, or claim camera-profile
quality. A later PR must attach approved rights, hashes, capture metadata,
render artifacts, and DeltaE/skin-tone review evidence before any entry can be
treated as runtime quality proof.

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
- camera-profile RAW corpus placeholders staying private or payload-free until
  rights and reference metadata are approved.

This does not replace DeltaE measurement, ColorChecker patch extraction,
camera-profile transform tests, preview/export parity, or CPU/GPU parity.

## Validation Evidence

- `bun run check:colorchecker-fixtures`
- `bun run check:unsafe-casts`
- `bunx prettier --check tests/integration/checks/check-colorchecker-fixtures.ts fixtures/color/colorchecker-fixture-manifest.json docs/color/fixtures/colorchecker-fixtures-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
