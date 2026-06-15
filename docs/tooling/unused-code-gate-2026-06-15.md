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
