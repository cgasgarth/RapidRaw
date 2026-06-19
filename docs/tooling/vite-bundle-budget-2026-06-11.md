# Vite Bundle Budget

Issues: #288, #2403

The RapidRAW frontend still produces one large application chunk. That is
accepted temporarily, but it is tracked as an explicit budget instead of an
unowned Vite warning.

## Build Mode Policy

Bundle budgets measure the minified production Vite build produced by:

```sh
bun run build:frontend
```

`vite.config.js` always uses esbuild minification for JavaScript and CSS in
build output. `TAURI_ENV_DEBUG` only controls sourcemap generation; it does not
disable minification or relax bundle budgets.

Use the dev server or debug sourcemaps for local debugging. If a local-only
unminified diagnostic build is added later, it must be named separately and must
not feed required CI, packaging, or bundle-budget measurement. Do not turn off
release minification to make a bundle check pass.

If a temporary budget exception is needed, track it in a GitHub issue with an
owner, reason, and expiration condition.

## Current Budget

| Asset class              | Raw budget      | Gzip budget   |
| ------------------------ | --------------- | ------------- |
| Largest JavaScript asset | 3,072,000 bytes | 900,000 bytes |
| Largest CSS asset        | 153,600 bytes   | 24,576 bytes  |

| Aggregate               | Raw budget      | Gzip budget   |
| ----------------------- | --------------- | ------------- |
| Initial entry aggregate | 3,225,600 bytes | 924,576 bytes |

Vite warning limit: 3,000 KiB.

Headroom policy: Temporary monolithic UI headroom; lower after measured chunk
splitting.

## Validation

Run:

```sh
bun run check:bundle
```

This command builds the minified production frontend and then runs
`scripts/check-vite-bundle-budget.ts` against `dist/index.html` and
`dist/assets`.

Release packaging uses the same frontend contract. See
[Raw editor frontend release build contract](../release/raw-editor-frontend-release-build-contract-2026-06-19.md).

It also writes a review artifact under `artifacts/bundle-report/`:

- `vite-bundle-report.json` for follow-up diff and trend tooling;
- `vite-bundle-report.md` for compact human review.

CI uploads this report from the frontend build job.

The same report can include source-map-backed module and package attribution
when source maps are intentionally emitted for diagnostics:

```sh
TAURI_ENV_DEBUG=1 bun run build:frontend
bun run bundle:report
```

This diagnostic flow does not change release packaging. Source maps stay out of
the required production build, but the report explains when maps are unavailable
instead of emitting misleading empty attribution.

The same gate runs a production payload scan against `dist` to reject sourcemap
artifacts, sourcemap comments, localhost URLs, local user paths, and
debug/fixture-like asset names. Debug payloads belong in dev-only scripts or
explicitly named diagnostic artifacts, not in required production build output.

## Policy

- The current monolithic JavaScript chunk is accepted as temporary debt.
- Growth beyond the raw or gzip budget fails validation.
- Initial-entry aggregate budgets include assets directly referenced by
  `dist/index.html` plus recursively static-imported JS/CSS. Dynamic imports are
  excluded from the initial aggregate and remain subject to the per-file caps.
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
  is too close to a cap, recalibrate the cap with explicit headroom, then create
  follow-up issues for bundle reports, chunking, or dependency audits.
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
- #2407 migrates JavaScript minification from esbuild to Oxc when the project is
  ready for the Vite 8 minifier change.
