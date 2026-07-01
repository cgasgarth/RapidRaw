# Validation Docs

Validation documentation separates human-review material from proof artifacts:

- `fixtures/` contains committed fixture manifests and fixture source policy.
- `harnesses/` contains validation harness notes and runtime proof policy.
- `proofs/` contains committed proof packets grouped by product area.
- `reports/` contains human-review dashboards and review pages.

Private or routine generated artifacts should not be added as new root-level
files. Commit generated validation output only when it is durable review
evidence for a product behavior, and keep it under the owning proof folder.

For local macOS app verification with Computer Use, use the focused checklist in
`../tooling/local-checks/local-macos-app-e2e-checklist-2026-07-01.md` and the
report template in `reports/local-macos-app-e2e-report.template.md`. Failed
checklist steps need runtime evidence and a linked GitHub issue unless they are
fixed in the same PR.
