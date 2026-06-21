# Super-Resolution Private RAW Decode Smoke

- Issue: #2139
- Parent: #1506

## Boundary

The first private super-resolution RAW slice is `private_decode_smoke` only. It proves the production RAW loader can ingest the private NEF burst and emit metadata-only evidence. It does not claim registration, reconstruction quality, app-server apply, preview/export parity, UI review, or full private RAW E2E acceptance.

## Semantics

- Use the computational private run report collection.
- Require `source_raw_sequence_private`, `decode_report_private`, and `quality_report_private`.
- Reject `merge_output_private`, `preview_after_private`, and `export_after_private` for this partial status.
- Require decode metrics: `decodedSourceCount`, `decodedFinitePixelRatio`, and `decodedNonzeroDimensionCount`.

## Validation

- `bun run check:sr-real-raw-private-proof`
- `bun run check:computational-private-report-checker-negative-cases`
- `bun run check:types`
