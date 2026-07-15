import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { BasicAdjustment, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  type BasicToneCommitIdentity,
  buildBasicToneEditTransaction,
} from '../../../src/utils/basicToneEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/basic-tone.ARW';
const session = createEditorImageSession({ generation: 12, path: sourcePath, source: 'cache' });
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

describe('basic tone edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), flipHorizontal: true };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
    });
  });

  test('commits one scene-global exposure revision while preserving geometry and Undo', () => {
    const state = useEditorStore.getState();
    const request = buildBasicToneEditTransaction(state, identity(), BasicAdjustment.Exposure, 0.65, 'basic-exposure');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'scene_global_color_tone', patch: { exposure: 0.65 }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['exposure'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'manual-control',
    });
    expect(result.afterEditDocumentV2.nodes.geometry).toEqual(result.beforeEditDocumentV2.nodes.geometry);
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone.params.exposure).toBe(0.65);
    expect(result.invalidatedStages).not.toContain('geometry');
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.exposure).toBe(0);
    expect(useEditorStore.getState().adjustments.flipHorizontal).toBe(true);
  });

  test('supports every Basic field, exact no-ops, and stale source/session/revision rejection', () => {
    const state = useEditorStore.getState();
    const fields = Object.values(BasicAdjustment);
    for (const field of fields) {
      expect(buildBasicToneEditTransaction(state, identity(), field, 0, `basic-${field}`).operations).toEqual([
        { nodeType: 'scene_global_color_tone', patch: { [field]: 0 }, type: 'patch-edit-document-node' },
      ]);
    }

    const noOp = state.applyEditTransaction(
      buildBasicToneEditTransaction(state, identity(), BasicAdjustment.Exposure, 0, 'basic-no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    expect(() =>
      buildBasicToneEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        BasicAdjustment.Exposure,
        1,
        'stale-source',
      ),
    ).toThrow('basic_tone_transaction.stale_source');
    expect(() =>
      buildBasicToneEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        BasicAdjustment.Exposure,
        1,
        'stale-session',
      ),
    ).toThrow('basic_tone_transaction.stale_session');
    expect(() =>
      buildBasicToneEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        BasicAdjustment.Exposure,
        1,
        'stale-revision',
      ),
    ).toThrow('basic_tone_transaction.stale_revision');
  });
});
