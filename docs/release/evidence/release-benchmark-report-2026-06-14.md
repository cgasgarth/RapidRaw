# Release Benchmark Report

Issue: #257 `release(benchmarks): add benchmark report`

## Purpose

Release candidates need a compact benchmark report that can be attached to
release evidence without hand-copying timing output from logs. The first report
source is the existing performance smoke JSON because it is deterministic,
fixture-backed, and already records elapsed time, budget, status, exit code, and
signal per check.

## Local Commands

Generate source timings:

```sh
bun run check:performance-smoke
```

Generate the release benchmark report:

```sh
bun run release:benchmark-report -- --release local
```

Validate the generator:

```sh
bun run check:release-benchmark-report
```

The generated report is written to:

```text
artifacts/release-benchmarks/release-benchmark-report.md
```

## Report Contract

The generator validates the input with Zod before writing Markdown. It accepts
the `performance-smoke/v1` JSON shape and emits:

- release label;
- generated timestamp from the source report;
- total elapsed time;
- budget multiplier;
- pass/fail summary;
- per-check elapsed time, budget, headroom, exit code, and signal;
- explicit limits on what the report does not prove.

If any benchmark entry has `status: fail`, the Markdown is still written and the
generator exits nonzero.

## Current Coverage

This is a release-readiness smoke benchmark report. It covers command startup,
schema and fixture validation, path routing, and current lightweight panorama,
super-resolution, focus, and film fixture timing checks.

It does not yet prove RAW decode latency, GPU preview latency, export
throughput, large-image memory ceilings, or rendered image quality.

## Promotion Path

As stable runtime benchmarks land, they should be added to the performance smoke
source first, then automatically appear in the release benchmark report:

- RAW decode and camera profile fixture timing;
- preview render latency on representative macOS hardware;
- HDR, panorama, focus stack, and super-resolution render timing;
- export throughput and memory ceiling checks;
- negative lab inversion and film simulation fixture timing.
