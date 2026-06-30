# Validation Docs

Validation documentation separates human-review material from proof artifacts:

- `fixtures/` contains committed fixture manifests and fixture source policy.
- `harnesses/` contains validation harness notes and runtime proof policy.
- `proofs/` contains committed proof packets grouped by product area.
- `reports/` contains human-review dashboards and review pages.

Private or routine generated artifacts should not be added as new root-level
files. Commit generated validation output only when it is durable review
evidence for a product behavior, and keep it under the owning proof folder.
