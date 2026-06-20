# Focus Stack Private RAW Decode Smoke

- Issue: #2137
- Parent: #1507

## Boundary

The first private focus-stack RAW slice is `private_decode_smoke` only. It proves the production RAW loader can ingest the private project-owned Alaska ARW focus sequence and emit metadata-only evidence. It does not claim focus alignment, stack quality, app-server apply, preview/export parity, UI review, or full private RAW E2E acceptance.

## Semantics

- Use the computational private run report collection.
- Require `source_raw_sequence_private`, `decode_report_private`, and `quality_report_private`.
- Reject `merge_output_private`, `preview_after_private`, and `export_after_private` for this partial status.
- Require decode metrics: `decodedSourceCount`, `decodedFinitePixelRatio`, and `decodedNonzeroDimensionCount`.

## Validation

- `bun run check:focus-real-raw-private-proof`
- `bun run check:computational-private-report-checker-negative-cases`
- `bun run check:current-pr-local`
