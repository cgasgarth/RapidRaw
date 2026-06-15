# Tauri Invoke Boundary Ratchet

- Issue: #1320
- Status: partial progress, not full closure
- Validation command: `bun run check:tauri-invoke-boundaries`

## Purpose

Raw Tauri `invoke` calls should move behind `invokeWithSchema` so TypeScript-facing payloads are parsed through Zod at the command boundary. The current codebase still has existing raw invoke debt, so this gate is a ratchet: it blocks new debt while migration happens in follow-up PRs.

## Current Caps

- Raw invoke import files: 29
- Raw invoke calls: 154
- Typed raw invoke calls: 59

The script parses TypeScript/TSX with the TypeScript compiler API. It detects named `invoke` imports from `@tauri-apps/api/core`, including aliases, then counts direct calls. `src/utils/tauriSchemaInvoke.ts` is allowlisted because it owns the schema wrapper.

## Follow-Up Work

Reduce the caps as callsites migrate to `invokeWithSchema` and command-specific Zod schemas. Do not close #1320 until raw invoke usage is either migrated or covered by a documented void-command allowlist.
