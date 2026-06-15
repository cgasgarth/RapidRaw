# Strict Boolean Expressions Evaluation

- Issue: #1355
- Candidate rule: `@typescript-eslint/strict-boolean-expressions`
- Probe command:
  `./node_modules/.bin/eslint . --format json --max-warnings 0` with the rule
  temporarily enabled as `error`
- Current decision: defer global enablement; evaluate scoped cleanup later.

## Result

The rule reported 766 errors across 79 files. The volume is too high for a
single PR gate because most findings are broad UI truthiness cleanup, not a small
set of immediately actionable correctness issues.

Top files:

| Count | File                                            |
| ----: | ----------------------------------------------- |
|    51 | `src/components/panel/right/MasksPanel.tsx`     |
|    38 | `src/components/panel/editor/ImageCanvas.tsx`   |
|    37 | `src/components/panel/Editor.tsx`               |
|    35 | `src/components/panel/right/AIPanel.tsx`        |
|    34 | `src/hooks/useSortedLibrary.ts`                 |
|    29 | `src/hooks/useAppContextMenus.ts`               |
|    26 | `src/components/panel/right/PresetsPanel.tsx`   |
|    24 | `src/components/panel/SettingsPanel.tsx`        |
|    20 | `src/components/panel/editor/EditorToolbar.tsx` |
|    19 | `src/hooks/useAppNavigation.ts`                 |

Top finding classes:

| Count | Finding                        |
| ----: | ------------------------------ |
|   472 | Nullable string conditionals   |
|   139 | Nullable number conditionals   |
|   106 | Nullable boolean conditionals  |
|    22 | Non-boolean conditional values |
|    19 | Nullable enum conditionals     |
|     6 | `any` values in conditionals   |

## Decision

Do not enable the rule globally yet. The current baseline would produce noisy UI
cleanup, and a broad rewrite risks changing empty-string, zero, nullish, and
fallback semantics without enough feature proof.

## Promotion Path

1. Start with schema, command-bus, Tauri boundary adapters, app-server tools, and
   pure utility modules.
2. Prefer explicit comparisons that preserve current semantics:
   `value !== null`, `value !== undefined`, `value.length > 0`, and
   `Number.isFinite(value)`.
3. Add focused tests or fixtures before changing numeric/image-processing
   branches.
4. Enable the rule only for a scoped override once that scope is clean.

Global enablement remains deferred until the violation count is much lower and
the remaining cases are known to be style-only.
