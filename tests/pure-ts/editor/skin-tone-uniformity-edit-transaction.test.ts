import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';
import {
  buildSkinToneUniformityEditTransaction,
  type SkinToneUniformityCommitIdentity,
  selectSkinToneUniformity,
} from '../../../src/utils/skinToneUniformityEditTransaction';

const sourcePath = '/fixture/skin-tone-uniformity.ARW';
const session = createEditorImageSession({ generation: 53, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<SkinToneUniformityCommitIdentity> = {}): SkinToneUniformityCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('skin-tone uniformity edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      finalPreviewUrl: 'blob:skin-before',
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: 53,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: {
        artifactId: 'skin-navigator-before',
        imageSessionId: session.id,
        sourceIdentity: sourcePath,
        url: 'blob:skin-navigator-before',
      },
      selectedImage,
      transformedOriginalUrl: 'blob:skin-transformed-before',
    });
  });

  test('commits, resets, undoes, and redoes one focused output-invalidating node transaction', () => {
    const before = useEditorStore.getState();
    const sibling = before.editDocumentV2.nodes.selective_color_mixer;
    const edited = { ...INITIAL_ADJUSTMENTS.skinToneUniformity, enabled: true, targetHueDegrees: 31 };
    const request = buildSkinToneUniformityEditTransaction(before, identity(), edited, 'skin-tone-edit');
    const result = before.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'skin_tone_uniformity',
        patch: { skinToneUniformity: edited },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['skinToneUniformity'],
      invalidatedStages: ['preview', 'navigator', 'thumbnail'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 1,
      finalPreviewUrl: null,
      historyIndex: 1,
      navigatorPreviewArtifact: null,
      transformedOriginalUrl: null,
    });
    expect(selectSkinToneUniformity(result.afterEditDocumentV2)).toEqual(edited);
    expect(result.afterEditDocumentV2.nodes.selective_color_mixer).toBe(sibling);

    const editedState = useEditorStore.getState();
    editedState.applyEditTransaction(
      buildSkinToneUniformityEditTransaction(
        editedState,
        identity({ adjustmentRevision: 1 }),
        INITIAL_ADJUSTMENTS.skinToneUniformity,
        'skin-tone-reset',
      ),
    );
    expect(selectSkinToneUniformity(useEditorStore.getState().editDocumentV2)).toEqual(
      INITIAL_ADJUSTMENTS.skinToneUniformity,
    );
    useEditorStore.getState().undo();
    expect(selectSkinToneUniformity(useEditorStore.getState().editDocumentV2)).toEqual(edited);
    useEditorStore.getState().redo();
    expect(selectSkinToneUniformity(useEditorStore.getState().editDocumentV2)).toEqual(
      INITIAL_ADJUSTMENTS.skinToneUniformity,
    );
  });

  test('persists and reopens canonical node authority without a legacy duplicate', () => {
    const before = useEditorStore.getState();
    const edited = { ...INITIAL_ADJUSTMENTS.skinToneUniformity, enabled: true, saturationUniformity: 0.55 };
    before.applyEditTransaction(buildSkinToneUniformityEditTransaction(before, identity(), edited, 'skin-tone-save'));
    const committed = useEditorStore.getState();
    const reopened = hydrateImageOpenEditDocumentV2(
      { adjustments: committed.adjustments, editDocumentV2: committed.editDocumentV2 },
      committed.adjustments,
    );

    expect(selectSkinToneUniformity(reopened)).toEqual(edited);
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('skinToneUniformity');
    expect(reopened).toEqual(committed.editDocumentV2);
  });

  test('rejects stale identities and malformed or out-of-range settings before mutation', () => {
    const state = useEditorStore.getState();
    expect(() =>
      buildSkinToneUniformityEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/other.ARW' }),
        INITIAL_ADJUSTMENTS.skinToneUniformity,
        'stale-source',
      ),
    ).toThrow('skin_tone_uniformity_transaction.stale_source');
    expect(() =>
      buildSkinToneUniformityEditTransaction(
        state,
        identity({ imageSessionId: 'stale-session' }),
        INITIAL_ADJUSTMENTS.skinToneUniformity,
        'stale-session',
      ),
    ).toThrow('skin_tone_uniformity_transaction.stale_session');
    expect(() =>
      buildSkinToneUniformityEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        INITIAL_ADJUSTMENTS.skinToneUniformity,
        'stale-revision',
      ),
    ).toThrow('skin_tone_uniformity_transaction.stale_revision');
    expect(() =>
      buildSkinToneUniformityEditTransaction(
        state,
        identity(),
        { ...INITIAL_ADJUSTMENTS.skinToneUniformity, targetHueDegrees: 360 },
        'invalid-settings',
      ),
    ).toThrow();
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
  });
});
