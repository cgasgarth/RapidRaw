# Vite Bundle Regression Triage

Issue: #2432

Use this runbook when `bun run check:bundle` fails, when CI reports a Vite
bundle budget regression, or when a PR intentionally changes frontend bundle
size.

## First Checks

Run the same local gate CI uses:

```sh
bun run check:bundle
```

If the failure is size-related, keep the failing summary and generate the
review report:

```sh
bun run build:frontend
bun run bundle:report
```

The report is written under `artifacts/bundle-report/`. Use
`vite-bundle-report.md` for human review and `vite-bundle-report.json` for
diffs or trend tooling.

## Source Attribution

Source-map-backed attribution is diagnostic only. It must not change release
packaging:

```sh
TAURI_ENV_DEBUG=1 bun run build:frontend
bun run bundle:report
```

Use this when the raw or gzip delta is not obvious from changed files. The
normal production build must still omit sourcemaps and pass the production
payload scan inside `bun run check:bundle`.

## Compare Reports

When a baseline report is available, compare it with the current report:

```sh
bun run bundle:diff -- --base path/to/base-report.json --head artifacts/bundle-report/vite-bundle-report.json
```

Attach the generated diff artifact or the key raw/gzip numbers to the PR.

## Decision Path

Prefer these actions in order:

1. Revert accidental imports, debug payloads, fixture payloads, or broad static
   imports that are not needed by the PR.
2. Lazy-load UI that is not part of first paint or the default editing surface.
3. Split a feature boundary when a specific route, panel, or tool causes most of
   the growth.
4. Replace or remove a dependency only after source attribution proves it is a
   meaningful contributor and the product behavior can stay intact.
5. Recalibrate the budget only when the growth is intentional, measured, tied to
   product value, and follow-up reduction work is tracked.
6. Add a temporary exception only with an owner, reason, linked issue, and
   expiration condition.

Do not raise a budget to hide accidental growth, debug artifacts, sourcemaps in
normal production output, or a change that can be isolated with lazy-loading.

## PR Evidence

For PRs that change bundle size, include:

- exact validation commands;
- largest JavaScript raw/gzip numbers;
- largest CSS raw/gzip numbers when CSS changed;
- initial-entry aggregate raw/gzip numbers;
- whether sourcemaps were used for diagnostic attribution;
- chosen action: revert, lazy-load, split, replace dependency, recalibrate, or
  exception;
- residual risk or follow-up issue when the budget remains close to a warning or
  failure tier.

## CI Context

`bun run check:bundle` runs the contract, minification, production payload,
budget, and report checks. CI uploads the bundle report from the frontend build
job so regressions can be reviewed without rerunning locally.

The current policy and thresholds live in
[Vite bundle budget](vite-bundle-budget-2026-06-11.md). Dependency-level
attribution guidance lives in
[Frontend bundle dependency audit](frontend-bundle-dependency-audit-2026-06-19.md).
