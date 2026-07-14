#!/usr/bin/env bun

import { applyFilmEmulationOperationV1Schema } from '../../../../packages/rawengine-schema/src/index.ts';
import {
  applyFilmEmulationOperation,
  createFilmEmulationTargetState,
} from '../../../../src/utils/film-look/filmEmulationOperation.ts';

const state = createFilmEmulationTargetState({ kind: 'image', variantId: 'ui-adapter-image' });
const command = {
  actor: { id: 'rapidraw-ui', kind: 'ui', sessionId: 'ui-adapter' },
  approval: { approvalClass: 'edit_apply', reason: 'Film UI profile selection', state: 'approved' },
  commandId: 'film-ui-adapter-1',
  commandType: 'edit.apply_film_emulation_operation',
  contractVersion: 1,
  correlationId: 'film-ui-adapter-correlation',
  dryRun: false,
  expectedGraphRevision: state.graphRevision,
  idempotencyKey: 'film-ui-adapter-idem',
  operation: {
    kind: 'set_profile',
    profileRef: {
      id: 'rapidraw.reference_film.v1',
      version: '1',
      contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef',
    },
  },
  schemaVersion: 1,
  target: state.target,
};
const parsed = applyFilmEmulationOperationV1Schema.parse(command);
const applied = applyFilmEmulationOperation(parsed, state);
if (applied.state.node === null || applied.state.history.length !== 1 || applied.result.mutates !== true) {
  throw new Error('UI adapter did not persist the canonical Film node.');
}
if (JSON.stringify(applied.state.node).includes('filmLookId')) throw new Error('UI adapter wrote legacy Film fields.');

console.log('film UI command adapter ok (canonical operation/readback only)');
