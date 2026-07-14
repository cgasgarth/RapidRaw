#!/usr/bin/env bun

import {
  filmStageControlDescriptorV1Schema,
  filmStageControlV1Schema,
} from '../../../../packages/rawengine-schema/src/index.ts';
import {
  applyFilmEmulationOperation,
  createFilmEmulationTargetState,
} from '../../../../src/utils/film-look/filmEmulationOperation.ts';
import {
  buildFilmStageOperation,
  FILM_REFERENCE_STAGE_DEFAULT_P,
  getFilmStageControlDescriptors,
  isFilmStageControlModified,
} from '../../../../src/utils/film-look/filmStageControls.ts';

const descriptor = getFilmStageControlDescriptors()[0];
if (descriptor === undefined) throw new Error('No renderer-owned Film stage descriptor was emitted.');
filmStageControlDescriptorV1Schema.parse(descriptor);
filmStageControlV1Schema.parse(descriptor.control);
if (isFilmStageControlModified(descriptor)) throw new Error('Profile default incorrectly marked modified.');

const changedDescriptor = getFilmStageControlDescriptors(1.25)[0];
if (changedDescriptor === undefined || !isFilmStageControlModified(changedDescriptor))
  throw new Error('Bounded override was not marked modified.');
const operation = buildFilmStageOperation(changedDescriptor, 1.25);
const state = createFilmEmulationTargetState({ kind: 'image', variantId: 'film-stage-controls' });
const applied = applyFilmEmulationOperation(
  {
    actor: { id: 'film-stage-controls', kind: 'test' },
    approval: { approvalClass: 'edit_apply', reason: 'descriptor contract', state: 'approved' },
    commandId: 'film-stage-controls-1',
    commandType: 'edit.apply_film_emulation_operation',
    contractVersion: 1,
    correlationId: 'film-stage-controls-correlation',
    dryRun: false,
    expectedGraphRevision: state.graphRevision,
    operation,
    schemaVersion: 1,
    target: state.target,
  },
  state,
);
if (applied.state.node?.stageParams?.referenceLuminanceShaperP !== 1.25)
  throw new Error('Descriptor change did not route through the canonical stage operation.');
if (FILM_REFERENCE_STAGE_DEFAULT_P === 1.25) throw new Error('Fixture default unexpectedly matches override.');

console.log('film stage controls ok (descriptor bounds, modified state, canonical routing)');
