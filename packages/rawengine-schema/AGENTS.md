# Shared Schema Scope

Inherits the repository-root instructions. This file applies under `packages/rawengine-schema/`.

- This package is the stable cross-boundary contract; avoid importing application UI or native runtime internals.
- Define TS-facing runtime data with Zod and derive static types from schemas rather than duplicating shapes.
- Contract changes require representative valid/invalid samples and compatibility/migration treatment where persisted data exists.
- Keep identity, version, units, enum values, and optionality explicit; reject ambiguous coercion.
- Generated outputs must be reproducible from maintained package commands and committed only when they are canonical artifacts.
