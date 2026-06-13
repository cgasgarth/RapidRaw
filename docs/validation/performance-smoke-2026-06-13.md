# Performance Smoke

Issue: #70 `validation(performance): add performance smoke script`

## Purpose

The performance smoke is a lightweight timing guard for cheap validation paths.
It does not claim image-rendering benchmark coverage. It catches obvious
regressions in command startup, fixture validation, schema sample validation, and
path-routing checks before heavier image-quality or native-render benchmarks are
available.

## Local Command

```sh
bun run check:performance-smoke
```

The command writes:

```text
artifacts/performance-smoke/performance-smoke-report.json
```

## Covered Checks

The smoke currently times these deterministic commands:

- `bun scripts/ci-classify-macos-smoke.mjs --self-test`
- `bun scripts/check-generated-type-drift.mjs`
- `bun scripts/check-film-look-fixture-outputs.mjs`
- `bun packages/rawengine-schema/scripts/check-sample-artifacts.mjs`

Each command has a conservative elapsed-time budget. The script fails if a
command exits nonzero, times out, or exceeds its effective budget.

## Budget Multiplier

Slow local machines or temporary CI pressure can use:

```sh
RAWENGINE_PERFORMANCE_SMOKE_BUDGET_MULTIPLIER=2 bun run check:performance-smoke
```

Do not raise the multiplier in required gates without documenting why. Repeated
budget misses should become a follow-up issue with the report attached.

## GitHub Actions

The manual `Performance Regression` workflow runs the smoke on Ubuntu, writes the
JSON report to the job summary, and uploads it as `performance-smoke-report`.
The preview-latency and large-image-memory lanes remain readiness checks until
their real benchmark commands land.

## Future Work

- Add renderer-level image fixture benchmarks after golden render commands land.
- Add preview-latency measurements once interactive controls expose a stable
  test harness.
- Add memory-budget tests for panorama, HDR, focus stacking, and super-resolution
  once those engines have deterministic preflight estimators.
