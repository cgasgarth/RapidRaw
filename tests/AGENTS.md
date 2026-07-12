# Test Scope

Inherits the repository-root instructions. This file applies under `tests/`.

- Prove product behavior and externally meaningful invariants, not source strings, command names, or workflow metadata.
- Prefer deterministic clocks, injected boundaries, synthetic fixtures, and explicit identities over sleeps or timing luck.
- Keep regression tests in the closest maintained suite; do not add one-off package scripts for individual tests.
- A UI-only assertion does not prove native output, and a schema-only assertion does not prove runtime behavior.
- Benchmarks must assert budgets, boundedness, or stability and fail when the claimed performance contract regresses.
- Tests must clean processes, temporary files, listeners, and environment changes even on failure.
