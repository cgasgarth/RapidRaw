import { beforeEach, describe, expect, test } from 'bun:test';

import { editDocumentToneEqualizerV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import type { BasicToneCommitIdentity } from '../../../src/utils/basicToneEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildToneEqualizerEditTransaction,
  isCurrentToneEqualizerAsyncRequest,
} from '../../../src/utils/toneEqualizerEditTransaction';

const sourcePath = '/fixture/tone-equalizer.ARW';
const session = createEditorImageSession({ generation: 17, path: sourcePath, source: 'cache' });
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: sourcePath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};
const identity = (overrides: Partial<BasicToneCommitIdentity> = {}): BasicToneCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('tone equalizer edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('commits one complete tone-equalizer node revision and preserves unrelated domains through Undo', () => {
    const state = useEditorStore.getState();
    const request = buildToneEqualizerEditTransaction(state, identity(), { enabled: true }, 'tone-enable');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'tone_equalizer',
        patch: { toneEqualizer: { ...INITIAL_ADJUSTMENTS.toneEqualizer, enabled: true } },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result).toMatchObject({ changedKeys: ['toneEqualizer'], nextAdjustmentRevision: 1, noOp: false });
    expect(
      editDocumentToneEqualizerV2Schema.parse(result.afterEditDocumentV2.nodes['tone_equalizer']?.params).toneEqualizer,
    ).toEqual({
      ...INITIAL_ADJUSTMENTS.toneEqualizer,
      enabled: true,
    });
    expect(result.afterEditDocumentV2.nodes['scene_curve']).toBe(result.beforeEditDocumentV2.nodes['scene_curve']);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.toneEqualizer.enabled).toBe(false);
  });

  test('rejects stale source, session, and revision before constructing a node transaction', () => {
    const state = useEditorStore.getState();
    expect(() =>
      buildToneEqualizerEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        { enabled: true },
        'stale-source',
      ),
    ).toThrow('tone_equalizer_transaction.stale_source');
    expect(() =>
      buildToneEqualizerEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        { enabled: true },
        'stale-session',
      ),
    ).toThrow('tone_equalizer_transaction.stale_session');
    expect(() =>
      buildToneEqualizerEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        { enabled: true },
        'stale-revision',
      ),
    ).toThrow('tone_equalizer_transaction.stale_revision');
  });

  test('accepts only the latest placement analysis for the captured source, session, and revision', () => {
    const state = useEditorStore.getState();
    expect(isCurrentToneEqualizerAsyncRequest(state, identity(), 7, 7)).toBeTrue();
    expect(isCurrentToneEqualizerAsyncRequest(state, identity(), 6, 7)).toBeFalse();
    expect(isCurrentToneEqualizerAsyncRequest(state, identity({ adjustmentRevision: 1 }), 7, 7)).toBeFalse();
    expect(
      isCurrentToneEqualizerAsyncRequest(
        { ...state, selectedImage: { path: '/fixture/successor.ARW' } },
        identity(),
        7,
        7,
      ),
    ).toBeFalse();
    expect(
      isCurrentToneEqualizerAsyncRequest(
        { ...state, imageSession: { id: 'editor-image-session:successor' } },
        identity(),
        7,
        7,
      ),
    ).toBeFalse();
  });
});
