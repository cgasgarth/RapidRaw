# Panorama Private RAW Decode Smoke

- Issue: #2130
- Parent: #1508
- Consult topic: panorama private RAW decode report boundary

## Boundary

The first private panorama RAW slice is `private_decode_smoke` only. It proves the production RAW loader can ingest the private RAF overlap sequence and emit metadata-only evidence. It does not claim alignment, stitch quality, app-server apply, preview/export parity, UI review, or full private RAW E2E acceptance.

## Accepted Semantics

- Use the computational private run report collection, but treat `panorama_stitch` + `private_decode_smoke` as a partial status.
- Require only `source_raw_sequence_private`, `decode_report_private`, and `quality_report_private`.
- Reject `merge_output_private`, `preview_after_private`, and `export_after_private` for this partial status.
- Require decode metrics: `decodedSourceCount`, `decodedFinitePixelRatio`, and `decodedNonzeroDimensionCount`.

## Validation

- `bun run check:panorama-real-raw-private-proof`
- `bun run check:computational-private-report-checker-negative-cases`
- `bun run check:types`
