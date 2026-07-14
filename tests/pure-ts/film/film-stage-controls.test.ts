import { describe, expect, test } from 'bun:test';

import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments';
import {
  applyFilmEmulationOperation,
  createFilmEmulationTargetState,
  REFERENCE_FILM_PROFILE_REF,
} from '../../../src/utils/film-look/filmEmulationOperation';
import {
  buildFilmStageOperation,
  FILM_REFERENCE_STAGE_DEFAULT_P,
  getFilmStageControlDescriptors,
} from '../../../src/utils/film-look/filmStageControls';

describe('renderer-owned Film stage controls', () => {
  test('descriptor writes canonical response operation and modified state', () => {
    const descriptor = getFilmStageControlDescriptors(1.25)[0];
    expect(descriptor).toBeDefined();
    if (descriptor === undefined) return;
    expect(descriptor.currentValue).toBe(1.25);
    expect(descriptor.defaultValue).toBe(FILM_REFERENCE_STAGE_DEFAULT_P);

    const initial = createFilmEmulationTargetState({ kind: 'image', variantId: 'stage-controls' });
    const profile = applyFilmEmulationOperation(
      {
        actor: { id: 'stage-controls', kind: 'test' },
        approval: { approvalClass: 'edit_apply', reason: 'descriptor test', state: 'approved' },
        commandId: 'stage-controls-profile',
        commandType: 'edit.apply_film_emulation_operation',
        contractVersion: 1,
        correlationId: 'stage-controls-profile',
        dryRun: false,
        expectedGraphRevision: initial.graphRevision,
        operation: { kind: 'set_profile', profileRef: REFERENCE_FILM_PROFILE_REF },
        schemaVersion: 1,
        target: initial.target,
      },
      initial,
    );
    const applied = applyFilmEmulationOperation(
      {
        actor: { id: 'stage-controls', kind: 'test' },
        approval: { approvalClass: 'edit_apply', reason: 'descriptor test', state: 'approved' },
        commandId: 'stage-controls-response',
        commandType: 'edit.apply_film_emulation_operation',
        contractVersion: 1,
        correlationId: 'stage-controls-response',
        dryRun: false,
        expectedGraphRevision: profile.state.graphRevision,
        operation: buildFilmStageOperation(descriptor, 1.25),
        schemaVersion: 1,
        target: profile.state.target,
      },
      profile.state,
    );
    expect(applied.state.node?.stageParams?.referenceLuminanceShaperP).toBe(1.25);
    expect(applied.state.history).toHaveLength(2);
    expect(applied.state.nodeHash).not.toBe(profile.state.nodeHash);
  });

  test('canonical Film node survives save/reopen normalization and reset removes it', () => {
    const node = {
      contractVersion: 1 as const,
      enabled: true,
      mix: 1,
      nodeType: 'film_emulation' as const,
      profileRef: REFERENCE_FILM_PROFILE_REF,
      seedPolicy: 'source_stable_v1' as const,
      stageParams: { referenceLuminanceShaperP: 1.25 },
      workingSpace: 'acescg_linear_v1' as const,
    };
    const reopened = normalizeLoadedAdjustments({ ...INITIAL_ADJUSTMENTS, filmEmulation: node });
    expect(reopened.filmEmulation).toEqual(node);
    expect(normalizeLoadedAdjustments({ ...reopened, filmEmulation: null }).filmEmulation).toBeNull();
  });
});
