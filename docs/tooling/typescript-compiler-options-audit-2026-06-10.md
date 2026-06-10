# TypeScript Compiler Options Audit

- Date: 2026-06-10
- Issue: #23 `tooling(tsconfig): audit current TypeScript compiler options`
- Branch: `codex/audit-tsconfig-options`
- Baseline commit: `5d46c11`

## Purpose

This audit records the current TypeScript compiler surface before RawEngine
tightens additional `tsconfig` flags. It is documentation-only: no compiler
option changes are made here.

## Toolchain

| Item                     | Value               |
| ------------------------ | ------------------- |
| Package manager          | Bun `1.3.13`        |
| TypeScript command       | `bun run typecheck` |
| TypeScript version       | `6.0.3`             |
| Typecheck exit code      | `2`                 |
| Current diagnostic count | `117`               |

## Explicit Compiler Options

Current `tsconfig.json` explicitly sets:

| Option                             | Current value       | Audit note                                                    |
| ---------------------------------- | ------------------- | ------------------------------------------------------------- |
| `types`                            | `[]`                | Prevents automatic global `@types/*` inclusion.               |
| `allowSyntheticDefaultImports`     | `true`              | Compatibility setting.                                        |
| `esModuleInterop`                  | `true`              | Compatibility setting.                                        |
| `forceConsistentCasingInFileNames` | `true`              | Already aligned with RawEngine target.                        |
| `isolatedModules`                  | `true`              | Already aligned with single-file transforms.                  |
| `jsx`                              | `react-jsx`         | React 17+ JSX transform.                                      |
| `lib`                              | `["dom", "esnext"]` | Browser plus latest JS libraries.                             |
| `module`                           | `nodenext`          | Node ESM/CJS resolution model.                                |
| `moduleResolution`                 | `nodenext`          | Matches `module`.                                             |
| `noUncheckedSideEffectImports`     | `true`              | Already stricter than many defaults.                          |
| `resolveJsonModule`                | `true`              | Needed for JSON imports.                                      |
| `rootDir`                          | `./src`             | Source-only compiler root.                                    |
| `skipLibCheck`                     | `true`              | Must be audited after project-owned errors are under control. |
| `strict`                           | `true`              | Enables the TypeScript strictness family.                     |
| `target`                           | `es2025`            | Current emitted language target.                              |

`bunx tsc --showConfig` also reports derived/defaulted values:

| Option               | Resolved value | Audit note                                          |
| -------------------- | -------------- | --------------------------------------------------- |
| `moduleDetection`    | `force`        | Derived by the current compiler/config combination. |
| `preserveConstEnums` | `true`         | Derived by the current compiler/config combination. |

## Planned Strict Flags

The RawEngine plan targets stricter checks beyond the current explicit config.
Their rollout should wait until the existing typecheck baseline is clean.

| Flag                                 | Current explicit state | Planned issue               | Readiness                                    |
| ------------------------------------ | ---------------------- | --------------------------- | -------------------------------------------- |
| `noUncheckedIndexedAccess`           | Not set                | #24                         | Blocked by #283                              |
| `exactOptionalPropertyTypes`         | Not set                | #25                         | Blocked by #283                              |
| `noImplicitOverride`                 | Not set                | #26                         | Blocked by #283                              |
| `noPropertyAccessFromIndexSignature` | Not set                | #27                         | Blocked by #283                              |
| `skipLibCheck` reduction/removal     | Explicitly `true`      | Follow-up from Section 9.1  | Blocked by #283 and dependency type review   |
| `verbatimModuleSyntax`               | Not set                | Needs issue before adoption | Blocked by #283 and module-system review     |
| `noFallthroughCasesInSwitch`         | Not set                | Needs issue before adoption | Blocked by #283                              |
| `noImplicitReturns`                  | Not set                | Needs issue before adoption | Blocked by #283                              |
| `noUnusedLocals`                     | Not set                | Needs issue before adoption | Blocked by #286 or a dedicated cleanup issue |
| `noUnusedParameters`                 | Not set                | Needs issue before adoption | Blocked by #286 or a dedicated cleanup issue |
| `allowUnreachableCode`               | Not set                | Needs issue before adoption | Blocked by #283                              |
| `allowUnusedLabels`                  | Not set                | Needs issue before adoption | Blocked by #283                              |

## Current Typecheck Failure Shape

Command:

```sh
bun run typecheck --pretty false
```

Result:

- Exit code: `2`
- Diagnostics starting with `src/`: `117`

Top diagnostic codes:

| Count | Code    | Primary meaning in this codebase                                   |
| ----- | ------- | ------------------------------------------------------------------ |
| 26    | TS2322  | Assignment incompatibilities, often UI prop or typed state shapes. |
| 25    | TS2339  | Missing properties on current model/settings/mask types.           |
| 24    | TS2345  | Argument incompatibilities, including typed i18n key usage.        |
| 13    | TS18048 | Possibly undefined values.                                         |
| 8     | TS7006  | Implicit `any` parameters.                                         |
| 5     | TS7016  | Missing declarations for imported packages.                        |
| 4     | TS7053  | Unsafe dynamic indexing.                                           |
| 4     | TS2698  | Spreads from values not proven to be objects.                      |
| 3     | TS18047 | Possibly null values.                                              |
| 2     | TS2882  | Missing module declarations for side-effect imports.               |
| 1     | TS2739  | Structural type missing required fields.                           |
| 1     | TS18046 | Unknown value used without narrowing.                              |
| 1     | TS1470  | `import.meta` under a CommonJS output path.                        |

Top files by diagnostic count:

| Count | File                                             |
| ----- | ------------------------------------------------ |
| 15    | `src/hooks/useAppNavigation.ts`                  |
| 13    | `src/components/panel/right/MasksPanel.tsx`      |
| 8     | `src/components/panel/library/LibraryItems.tsx`  |
| 7     | `src/components/panel/right/ExportPanel.tsx`     |
| 6     | `src/hooks/useImageProcessing.ts`                |
| 5     | `src/components/panel/right/MetadataPanel.tsx`   |
| 5     | `src/components/panel/editor/ImageCanvas.tsx`    |
| 5     | `src/components/adjustments/Curves.tsx`          |
| 4     | `src/hooks/useAiMasking.ts`                      |
| 4     | `src/components/panel/right/AIPanel.tsx`         |
| 4     | `src/components/panel/library/LibraryHeader.tsx` |

## Recommended Order

1. Close #283 by fixing current typecheck errors without adding stricter flags.
2. Add missing ambient declarations for CSS and `react-image-crop` imports early;
   they create repeated TS7016/TS2882 noise.
3. Stabilize typed app settings, image cache, mask parameter, and library item
   model boundaries before enabling strict indexed/optional access flags.
4. Re-run this audit command after #283 and before #24.
5. Enable strict flags one PR at a time, with `bun run typecheck` as the hard
   local and CI gate.

## Validation

Commands run for this audit:

```sh
bunx tsc --version
bunx tsc --showConfig
bunx tsc --help --all | rg -n "noUncheckedIndexedAccess|exactOptionalPropertyTypes|noImplicitOverride|noPropertyAccessFromIndexSignature|useUnknownInCatchVariables|noFallthroughCasesInSwitch|noImplicitReturns|noUnusedLocals|noUnusedParameters|allowUnreachableCode|allowUnusedLabels|verbatimModuleSyntax|skipLibCheck|noUncheckedSideEffectImports|strictNullChecks|noImplicitAny|strictFunctionTypes|strictBindCallApply|strictPropertyInitialization|noImplicitThis|alwaysStrict"
bun run typecheck --pretty false
```
