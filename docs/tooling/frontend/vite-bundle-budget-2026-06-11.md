# Vite Bundle Budget

Issues: #288, #2403, #4605

The RapidRAW frontend still produces one large application chunk. That is
accepted temporarily, but it is tracked as an explicit budget instead of an
unowned Vite warning.

## Build Mode Policy

Bundle budgets measure the minified production Vite build produced by:

```sh
bun run build
```

`vite.config.js` always uses Oxc minification for JavaScript and esbuild
minification for CSS in build output. `TAURI_ENV_DEBUG` only controls sourcemap
generation; it does not disable minification or relax bundle budgets.

Use the dev server or debug sourcemaps for local debugging. If a local-only
unminified diagnostic build is added later, it must be named separately and must
not feed required CI, packaging, or bundle-budget measurement. Do not turn off
release minification to make a bundle check pass.

If a temporary budget exception is needed, track it in a GitHub issue with an
owner, reason, and expiration condition.

## Current Budget

| Asset class              | Raw warning     | Gzip warning  | Raw failure     | Gzip failure  |
| ------------------------ | --------------- | ------------- | --------------- | ------------- |
| Largest JavaScript asset | 2,764,800 bytes | 810,000 bytes | 3,072,000 bytes | 900,000 bytes |
| Largest CSS asset        | 154,829 bytes   | 23,962 bytes  | 172,032 bytes   | 26,624 bytes  |

| Aggregate               | Raw warning     | Gzip warning  | Raw failure     | Gzip failure  |
| ----------------------- | --------------- | ------------- | --------------- | ------------- |
| Initial entry aggregate | 2,912,256 bytes | 833,962 bytes | 3,235,840 bytes | 926,624 bytes |

Vite warning limit: 3,000 KiB.

Headroom policy: Fail budgets keep about 10% emergency headroom above warning
thresholds.

Warning tier policy: Warnings are non-failing early signals; failures block PRs
until code is split, removed, or a temporary exception is documented.

## Tailwind Source Scope

The product entrypoint imports `src/product-styles.css`, which starts Tailwind
with `source(none)`, explicitly sources `index.html` plus `src`, and excludes
`src/validation/visual` from product source scanning. The visual smoke app
imports `src/validation/visual/visual-smoke-styles.css`, which keeps the
validation source scan separate so visual-only classes remain available to
visual smoke builds without entering the production product CSS bundle.

The measured #4605 comparison on July 1, 2026:

| Product CSS source scope                        | Raw CSS       | Gzip CSS      |
| ----------------------------------------------- | ------------- | ------------- |
| Explicit product sources with validation split  | 141,028 bytes | 20,122 bytes  |
| Shared automatic scan excluding validation only | 141,389 bytes | 20,218 bytes  |
| Including validation visual sources temporarily | 173,044 bytes | 24,181 bytes  |

The explicit product scope saves 32,016 raw bytes and 4,059 gzip bytes versus
scanning validation visual sources, and 361 raw bytes and 96 gzip bytes versus
the prior shared automatic scan with only a validation exclusion. The bundle
check also rejects selected validation-only Tailwind sentinels in initial
product CSS so future entrypoint changes do not silently rescan the visual smoke
harness.

## Validation

Run:

```sh
bun run check:bundle
```

This command builds the minified production frontend and then runs
`tests/integration/checks/check-vite-bundle-budget.ts` against `dist/index.html` and
`dist/assets`.

Release packaging uses the same `bun run build` output and budget check.

It also writes a review artifact under `artifacts/bundle-report/`:

- `vite-bundle-report.json` for follow-up diff and trend tooling;
- `vite-bundle-report.md` for compact human review.

CI uploads this report from the frontend build job.

The same report can include source-map-backed module and package attribution
when source maps are intentionally emitted for diagnostics:

```sh
TAURI_ENV_DEBUG=1 bun run build
bun run bundle:report
```

This diagnostic flow does not change release packaging. Source maps stay out of
the required production build, but the report explains when maps are unavailable
instead of emitting misleading empty attribution.

Compare two report JSON files locally with:

```sh
bun run bundle:diff -- --base path/to/base-report.json --head path/to/head-report.json
```

This writes `vite-bundle-diff.json` and `vite-bundle-diff.md` under
`artifacts/bundle-report/`. The diff is advisory; the existing budget gate
remains the pass/fail authority.

The same gate runs a production payload scan against `dist` to reject sourcemap
artifacts, sourcemap comments, localhost URLs, local user paths, and
debug/fixture-like asset names. Debug payloads belong in dev-only scripts or
explicitly named diagnostic artifacts, not in required production build output.

## Policy

- The current monolithic JavaScript chunk is accepted as temporary debt.
- Growth beyond a warning threshold emits a non-failing warning and should be
  addressed before the hard fail tier is reached.
- Growth beyond a raw or gzip failure budget fails validation.
- Initial-entry aggregate budgets include assets directly referenced by
  `dist/index.html` plus recursively static-imported JS/CSS. Dynamic imports are
  excluded from the initial aggregate and remain subject to the per-file caps.
- Product CSS must keep validation-only visual smoke Tailwind classes out of the
  initial bundle. If a visual smoke stylesheet split changes, update the
  sentinels in `tests/integration/checks/check-vite-bundle-budget.ts` with the
  same PR and include before/after CSS size evidence.
- HDR, panorama, color style, advanced color setup UI, Negative Lab frame queue,
  frame health UI, frame health schema wiring, visible frame warning chips, base
  sample readouts, the stock-family registry panel, and layer grouping controls
  increased the temporary JavaScript ceiling; future code-splitting should lower
  this again.
- A future code-splitting PR should lower the JavaScript budget after reducing
  the largest chunk.
- `vite.config.js` sets `chunkSizeWarningLimit` to the same raw budget range so
  Vite warnings and the explicit budget gate stay aligned.
- Normal UI work should not fight sub-kilobyte budget margins. When the baseline
  is too close to a cap, recalibrate the warning and failure tiers with explicit
  headroom, then create follow-up issues for bundle reports, chunking, or
  dependency audits.
- Mainline budget reductions should happen after measured bundle improvements,
  not by forcing feature PRs to remove useful controls or labels.

## Deferred Foundation

The next bundle-governance work is tracked in milestone
`19: Frontend Bundle Policy Foundation`:

- #2398 recalibrates budgets with warning/fail tiers and exception policy.
- #2399 adds a bundle analysis report artifact.
- #2400 adds trend visibility without noisy PR failures.
- #2401 audits and splits the first oversized UI boundary.
- #2402 audits large frontend dependencies before new UI growth.
- #2404 guards production builds against debug-only payloads.
- #2407 migrated JavaScript minification from esbuild to Oxc while keeping CSS
  minification on esbuild.
