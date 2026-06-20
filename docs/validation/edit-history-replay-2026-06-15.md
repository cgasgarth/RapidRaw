# Edit History Replay Validation

- Issue: #64
- Scope: current in-memory edit history push, undo, redo, jump, branch, and
  bounded-history behavior.
- Runtime status: store-backed helper validation. This does not replace the
  future graph-native command replay harness.

## Contract

`src/utils/editHistory.ts` provides pure helpers for the current editor history
model:

- push a new adjustment snapshot;
- truncate redo history when pushing from an older index;
- keep history bounded to 50 entries by default;
- undo to the previous snapshot;
- redo to the next snapshot;
- jump to a valid history index.

`src/store/useEditorStore.ts` uses those helpers for its current undo, redo,
push, and go-to-index actions.

## Validation

`tests/integration/checks/check-edit-history-replay.ts` replays representative adjustment
snapshots and verifies:

- undo restores the previous exposure/contrast snapshot;
- redo restores the next snapshot;
- go-to-index restores a selected snapshot;
- pushing after undo truncates redo history;
- the 50-entry cap remains stable.

`tests/integration/checks/check-command-replay-render-proof.ts` adds the first synthetic
headless render bridge for #1257. It builds a typed `toneColor.setBasicTone`
command from UI-style adjustments, replays it into history, renders a small
synthetic image through the same replayed adjustment state for preview and
export, and fails if the before/after hash is unchanged or preview/export output
diverges.

## Remaining Work

- Promote the synthetic headless render proof to real RAW fixtures once the
  private/public RAW corpus is available.
- Add graph-native command replay once edit graph commands own mutations.
- Add browser evidence for history context-menu selection.
- Add sidecar restart replay after command persistence lands.
