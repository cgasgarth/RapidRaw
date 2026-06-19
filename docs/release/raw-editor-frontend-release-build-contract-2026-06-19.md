# Raw Editor Frontend Release Build Contract

- Snapshot date: 2026-06-19
- Issue: #2433 `release(build): codify raw-editor frontend bundle contract`
- Runtime status: executable config contract; no release workflow behavior
  change.

## Purpose

RawEngine package and bundle-budget validation must measure the same frontend
artifact. Release packaging should not silently switch minification, sourcemaps,
or output directories through incidental environment variables.

## Contract

The measured frontend release artifact is:

```sh
bun run build:frontend
```

That command runs `vite build` and writes the production frontend to `dist`.
`bun run check:bundle` verifies the same artifact by running:

1. shared bundle policy drift checks;
2. Vite minification contract checks;
3. release frontend contract checks;
4. bundle-budget self-test;
5. `bun run build:frontend`;
6. bundle-budget enforcement against `dist/index.html` and `dist/assets`.

Tauri packaging consumes the same contract because `src-tauri/tauri.conf.json`
uses `beforeBuildCommand: "bun run build"` and `frontendDist: "../dist"`, while
`package.json` delegates `build` to `bun run build:frontend`.

## Environment Policy

- JavaScript and CSS release builds stay minified.
- `TAURI_ENV_DEBUG` may enable sourcemaps for packaging diagnostics.
- `TAURI_ENV_DEBUG` must not disable minification or bypass bundle budgets.
- A future unminified diagnostic build must use a separate script name and must
  not feed required CI, release packaging, or budget measurement.

## Validation

Run:

```sh
bun run check:release-frontend-contract
bun run check:bundle
```

The contract check fails if package scripts, Tauri frontend output, Vite
minification, or release workflow metadata drift away from this model.

## Related Docs

- [Vite bundle budget](../tooling/vite-bundle-budget-2026-06-11.md)
- [macOS package and notarization dry-run checklist](macos-package-notarization-dry-run-checklist-2026-06-19.md)
