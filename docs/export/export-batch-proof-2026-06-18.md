# Export Batch Proof

- Issue: #1279
- Status: synthetic export artifact gate, not full product E2E

`bun run check:export-batch-proof` validates export recipes, queue behavior, and
recipe UI rows, then records deterministic simulated output hashes at
`docs/validation/proofs/export/export-batch-proof-2026-06-18.json`.

This proves the batch queue and recipe contract slice. Full professional
workflow UI proof remains tracked by #1857.
