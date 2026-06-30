# Panorama Fixture Manifest

- Date: 2026-06-13
- Issue: #182 `validation(panorama): add panorama fixture set`
- Manifest: `fixtures/panorama/panorama-fixture-manifest.json`
- Validation: `bun run check:panorama-fixtures`

## Purpose

This adds the first panorama-specific fixture gate without committing heavy image
assets. The manifest defines deterministic synthetic fixture scenarios that
future plan, adapter, render, UI, and performance tests must satisfy.

## Fixture Scope

The manifest currently contains metadata-only fixtures:

- a small horizontal translation happy path;
- a disconnected-source warning path;
- a large plan-only memory-budget path.

Each fixture records source dimensions, deterministic generator identity,
expected output bounds, connected and excluded sources, memory budget, warning
codes, and validation purpose.

## Why Metadata First

Panorama validation needs stable contracts before runtime image generation and
golden artifacts become required. Metadata-only fixtures are cheap enough for PR
CI, safe for a public repository, and independent of runner RAM. Later PRs can
activate generated image assets once generators, output hashes, and visual
review artifacts exist.

## Follow-Up Requirements

Future fixture PRs should add:

- deterministic synthetic image generation;
- expected output image hashes or perceptual metrics;
- Rust render-smoke tests that consume the generated fixtures;
- HTML review artifacts with source overlays, match graph, warnings, and
  stitched previews;
- optional large/nightly fixture packs for memory and performance tests.

## Validation

Required local checks for this manifest:

- `bun run check:panorama-fixtures`
- `bun run docs:check`
- `bun run format:check -- tests/integration/checks/panorama/check-panorama-fixture-manifest.ts fixtures/panorama/panorama-fixture-manifest.json docs/validation/fixtures/panorama-fixture-manifest-2026-06-13.md package.json`
- `bun run check:unsafe-casts`
