# Unused Code Gate Evaluation

Issue: #1289

Command evaluated:

```sh
bunx knip@6.16.1 --reporter compact
```

Decision: keep Knip report-only for now via `bun run unused:report`; do not add a blocking `check:unused` gate yet.

Why not blocking yet:

- Schema packages intentionally export many public contract types before runtime usage exists.
- Feature validation scripts are dynamic entrypoints that Knip can misclassify without more config.
- Generated, visual-smoke, i18n, and workflow-driven files need explicit entrypoint modeling.
- The initial dependency signal is useful, but mixed with known false positives.

Useful findings:

- `js-yaml` is directly imported by workflow-policy scripts and should be declared.
- `react-draggable` appears unused and should be removed only after UI verification.
- Several schema exports may become real cleanup targets after API/runtime integrations land.

Follow-up candidates:

- Remove `react-draggable` if `bun run unused:report`, `bun run check:types`, and UI smoke stay clean.
- Split schema package Knip config from app config so public exports are evaluated with package-specific rules.
- Add a blocking dependency-only gate after false positives are reduced.

## Schema Package Split

Issue: #1387

Decision: model `packages/rawengine-schema` as its own Knip workspace and ignore unused export/type reports for `packages/rawengine-schema/src/**/*.ts`.

Why:

- The package is a public contract surface for edit graph/API/runtime schemas.
- Many schema exports are intentionally published before the app consumes every contract.
- Treating package exports like app-private dead code creates noisy false positives and weakens trust in the report.

Remaining cleanup candidates after the split:

- App runtime files that may need entrypoint modeling or removal:
  - `src/validation/visual/main.tsx`
  - `src/validation/visual/VisualSmokeApp.tsx`
  - `src/schemas/agentRuntimeSchemas.ts`
- Tooling scripts/configs that may need explicit entry modeling:
  - `i18next.config.ts`
  - `tests/integration/checks/check-agent-approval-boundaries.ts`
  - `tests/integration/checks/check-markdown-links.ts`
- Wrapped binary dependencies modeled in `ignoreDependencies`:
  - `i18next-cli`
  - `license-checker-rseidelsohn`
- App-level unused exports remain report-only until each candidate is verified against runtime usage, dynamic imports, and intended public API use.

## Dependency-Only Gate

Issue: #1386

Decision: add `bun run check:unused-deps` as a blocking dependency-only Knip gate.

Why:

- Dependency findings are now reliable enough to block after removing unused ESLint/Prettier integration packages.
- `i18next-cli` and `license-checker-rseidelsohn` are intentionally kept because repo-owned package scripts invoke their binaries through compact wrappers or direct `.bin` execution.
- Full unused files/exports remain report-only until dynamic entrypoints and public API surfaces are modeled.

Validation:

- `bun run check:unused-deps`
- `bun run unused:report`
