#!/usr/bin/env bun

import {
  applyFilmEmulationOperation,
  createFilmEmulationTargetState,
} from '../../../../src/utils/film-look/filmEmulationOperation.ts';
import { applyFilmEmulationAppServerOperation } from '../../../../src/utils/film-look/filmLookAppServerRoutes.ts';

const state = createFilmEmulationTargetState({ kind: 'virtual_copy', variantId: 'parity-variant' });
const command = {
  actor: { id: 'parity-test', kind: 'test', sessionId: 'ui-app-server-parity' },
  approval: { approvalClass: 'edit_apply', reason: 'parity', state: 'approved' },
  commandId: 'film-parity-1',
  commandType: 'edit.apply_film_emulation_operation',
  contractVersion: 1,
  correlationId: 'film-parity-correlation',
  dryRun: false,
  expectedGraphRevision: state.graphRevision,
  idempotencyKey: 'film-parity-idem',
  operation: { kind: 'set_mix', mix: 0.62 },
  schemaVersion: 1,
  target: state.target,
};
const ui = applyFilmEmulationOperation(command, state);
const appServer = applyFilmEmulationAppServerOperation(command, state);
if (ui.result.graphHash !== appServer.graphHash || ui.result.nodeHash !== appServer.nodeHash) {
  throw new Error('UI/App Server canonical Film result hashes diverged.');
}
if (appServer.resultingNode?.mix !== 0.62) throw new Error('App Server readback did not expose applied Film node.');

console.log('film UI/App Server command parity ok');
