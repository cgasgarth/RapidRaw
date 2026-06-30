# Mask Copy Paste Runtime Evidence

Issue: #119 `masks(copy): add mask copy paste`

Runtime status: UI runtime and fixture-backed helper coverage. This document
does not add new UI; it records the existing implementation and validation so
the issue can close without overclaiming API-command or graph-native support.

## Runtime Evidence

- `src/components/panel/right/MasksPanel.tsx` stores copied mask containers and
  sub-masks with `structuredClone`.
- The masks panel context menu exposes Paste Mask when a copied mask exists.
- Each mask row context menu exposes Copy Mask, Paste Mask, and Paste Mask
  Adjustments.
- Paste inserts the copied container or sub-mask at a bounded index, selects the
  pasted item, and expands the target container.
- Paste Mask Adjustments copies only the adjustment payload into the target mask
  container.
- English and localized menu labels already exist.

## Fixture Evidence

- `src/utils/mask/maskClipboard.ts` provides pure clone/insert helpers for mask
  containers and sub-masks.
- `fixtures/masks/compose/mask-copy-paste.json` covers clone/insert, invert/rename, and
  reset-adjustment behavior.
- `tests/integration/checks/masks/check-mask-copy-paste.ts` validates fixture expectations with Zod.

## Remaining Gaps

- Mask copy/paste is not yet routed through a typed command envelope.
- The UI path duplicates some clone/insert behavior instead of exclusively using
  the helper module.
- No browser screenshot was captured in this evidence PR because no visible UI
  was changed here.

## Validation

- `bun run check:mask-copy-paste`
- `bun run docs:check`
- `bun run check:unsafe-casts`
- `bunx prettier --check docs/layers/mask-copy-paste-runtime-2026-06-15.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md`
- `git diff --check`
