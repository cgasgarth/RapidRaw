#!/usr/bin/env bun

import {
  applyFilmEmulationOperation,
  createFilmEmulationTargetState,
  FilmEmulationOperationError,
  redoFilmEmulationOperation,
  reopenFilmEmulationTargetState,
  serializeFilmEmulationTargetState,
  undoFilmEmulationOperation,
} from '../../../../src/utils/film-look/filmEmulationOperation.ts';

const profileRef = {
  id: 'rapidraw.reference_film.v1' as const,
  version: '1' as const,
  contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef' as const,
};

const command = (
  state: ReturnType<typeof createFilmEmulationTargetState>,
  operation: unknown,
  id: string,
  dryRun = false,
) => ({
  actor: { id: 'history-test', kind: 'test', sessionId: 'film-history' },
  approval: {
    approvalClass: dryRun ? 'preview_only' : 'edit_apply',
    reason: 'history contract test',
    state: dryRun ? 'not_required' : 'approved',
  },
  commandId: id,
  commandType: 'edit.apply_film_emulation_operation',
  contractVersion: 1,
  correlationId: `${id}-correlation`,
  dryRun,
  expectedGraphRevision: state.graphRevision,
  idempotencyKey: `${id}-idem`,
  operation,
  schemaVersion: 1,
  target: state.target,
});

let state = createFilmEmulationTargetState({ kind: 'image', variantId: 'history-image' });
const initialSerialized = serializeFilmEmulationTargetState(state);
const dryRun = applyFilmEmulationOperation(
  command(state, { kind: 'set_profile', profileRef }, 'film-history-dry-run', true),
  state,
);
if (dryRun.result.mutates || dryRun.state.graphRevision !== state.graphRevision || dryRun.state.history.length !== 0) {
  throw new Error('Film dry run mutated graph state');
}

const applied = applyFilmEmulationOperation(
  command(state, { kind: 'set_profile', profileRef }, 'film-history-profile'),
  state,
);
state = applied.state;
const profileHash = state.nodeHash;
const mixed = applyFilmEmulationOperation(command(state, { kind: 'set_mix', mix: 0.62 }, 'film-history-mix'), state);
state = mixed.state;
const staged = applyFilmEmulationOperation(
  command(
    state,
    { kind: 'set_stage_params', stage: 'reference_luminance_shaper_v1', patch: { p: 0.7 } },
    'film-history-stage',
  ),
  state,
);
state = staged.state;
const placementCommand = command(
  state,
  { kind: 'set_stack_position', position: 'scene_creative_custom', afterNodeId: 'scene-curve' },
  'film-history-placement',
);
const placed = applyFilmEmulationOperation(placementCommand, state);
state = placed.state;
if (state.history.length !== 4 || state.node?.stageParams?.referenceLuminanceShaperP !== 0.7)
  throw new Error('Film history did not persist exact stage state');

const replay = applyFilmEmulationOperation(placementCommand, state);
if (!replay.result.idempotentReplay || replay.result.mutates || replay.state.history.length !== state.history.length)
  throw new Error('Film idempotent replay changed history');

try {
  applyFilmEmulationOperation(command(state, { kind: 'set_mix', mix: 0.1 }, 'film-history-placement'), state);
  throw new Error('conflicting command reuse was accepted');
} catch (error) {
  if (!(error instanceof FilmEmulationOperationError) || error.code !== 'film_idempotency_conflict') throw error;
}

const undone = undoFilmEmulationOperation(state);
if (undone.node?.stageParams?.referenceLuminanceShaperP !== 0.7 || undone.placement.position !== 'scene_creative_end') {
  throw new Error('Film undo failed to restore exact prior placement');
}
const redone = redoFilmEmulationOperation(undone);
if (redone.placement.position !== 'scene_creative_custom' || redone.nodeHash !== state.nodeHash)
  throw new Error('Film redo failed exact restoration');

const reopened = reopenFilmEmulationTargetState(serializeFilmEmulationTargetState(state));
if (
  reopened.graphHash !== state.graphHash ||
  reopened.nodeHash !== state.nodeHash ||
  reopened.history.length !== state.history.length
) {
  throw new Error('Film save/reopen hash or history mismatch');
}
if (profileHash === null || initialSerialized === serializeFilmEmulationTargetState(state))
  throw new Error('Film apply did not create durable state');

console.log('film operation history roundtrip ok (dry-run, apply, idempotency, undo/redo, save/reopen)');
