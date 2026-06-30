# Panorama Sidecar Artifact Persistence

- Date: 2026-06-13
- Issue: #982 `panorama(artifact): persist editable derived panorama sources`
- Milestone: 11: Panorama Stitching
- Scope: first sidecar contract for durable editable panorama artifacts.

## Summary

Panorama output must be durable project data, not only an in-memory image or an
exported TIFF/PNG. This slice introduces a preserved sidecar field for RawEngine
derived artifacts and validates that a sidecar can carry a full
`PanoramaArtifactV1` payload.

The runtime stitcher is not changed in this slice. The goal is to prevent future
panorama artifact records from being dropped by normal metadata load/save
roundtrips and to give CI a fixture that proves the contract.

## Sidecar Field

`ImageMetadata` now preserves an optional top-level `rawEngineArtifacts` object:

```json
{
  "rawEngineArtifacts": {
    "schemaVersion": 1,
    "panoramaArtifacts": [],
    "staleArtifactIds": []
  }
}
```

The field intentionally lives outside `adjustments`. Panorama artifacts are
derived source records with provenance, output handles, validation metrics, and
staleness state. Treating them as ordinary adjustment knobs would make them too
easy to overwrite during normal editor saves.

## V1 Contents

The initial object contains:

- `schemaVersion`: RawEngine artifact extension version.
- `panoramaArtifacts`: array of `PanoramaArtifactV1` payloads.
- `staleArtifactIds`: artifact IDs that should not be treated as current.

Future PRs should add stronger runtime helpers for inserting, replacing,
marking stale, and enumerating artifacts. This PR only establishes preservation
and validation.

## Invalidation Direction

Panorama artifact records should become stale when any of these inputs change:

- source image path or source content hash;
- source edit graph revision;
- virtual-copy ID;
- lens correction policy;
- projection, boundary, exposure, or seam settings;
- panorama engine ID or engine version;
- output artifact handle or content hash.

The fixture keeps `staleArtifactIds` empty to represent a current rendered
artifact. Staleness mutation tests should be a follow-up once runtime write
helpers exist.

## Validation

The sidecar roundtrip fixture now includes:

- a normal primary sidecar;
- a virtual-copy sidecar;
- a panorama sidecar that contains one full `PanoramaArtifactV1` payload under
  `rawEngineArtifacts.panoramaArtifacts`.

The checker validates the sidecar shape with Zod, validates the embedded
panorama artifact with the shared RawEngine schema, and JSON-roundtrips the
payload to catch accidental loss.

Required local checks:

- `bun run check:sidecar-roundtrip`
- `bun run schema:check`
- `cd src-tauri && cargo fmt -p RapidRAW -- --check`
- `cd src-tauri && cargo check --locked`
- `bun run check:unsafe-casts`
- `bun run docs:check`
- `git diff --check`
