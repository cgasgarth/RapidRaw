import { beforeEach, describe, expect, test } from 'bun:test';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { createDefaultMaskEditNodes, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildSubMaskInteractionEditTransaction,
  captureSubMaskInteractionIdentity,
  type SubMaskInteractionIdentity,
  scheduleSubMaskInteractionEnd,
} from '../../../src/utils/subMaskInteractionEditTransaction';

const sourcePath = '/fixture/sub-mask-drag.ARW';
const session = createEditorImageSession({ generation: 31, path: sourcePath, source: 'cache' });
const maskSubId = 'radial:1';
const aiSubId = 'quick-erase:1';
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

const captureIdentity = (transactionId: string): SubMaskInteractionIdentity => {
  const identity = captureSubMaskInteractionIdentity(useEditorStore.getState(), transactionId, {
    containerId: 'layer:1',
    containerKind: 'masks',
    subMaskId: maskSubId,
  });
  if (identity === null) throw new Error('expected selected-image interaction identity');
  return identity;
};

describe('sub-mask interaction edit transaction', () => {
  beforeEach(() => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure: 0.4,
      masks: [
        {
          adjustments: {},
          blendMode: 'normal' as const,
          editNodes: createDefaultMaskEditNodes(),
          editNodeSchemaVersion: 1 as const,
          id: 'layer:1',
          invert: false,
          name: 'Radial layer',
          opacity: 100,
          subMasks: [
            {
              id: maskSubId,
              invert: false,
              mode: SubMaskMode.Additive,
              opacity: 100,
              parameters: { centerX: 100, centerY: 200, feather: 0.5, radiusX: 40, radiusY: 30, rotation: 0 },
              type: Mask.Radial,
              visible: true,
            },
          ],
          visible: true,
        },
      ],
      aiPatches: [
        {
          id: 'patch:1',
          invert: false,
          isLoading: false,
          name: 'Quick Erase',
          patchData: null,
          prompt: '',
          subMasks: [
            {
              id: aiSubId,
              invert: false,
              mode: SubMaskMode.Additive,
              opacity: 100,
              parameters: { feather: 0.2 },
              type: Mask.QuickEraser,
              visible: true,
            },
          ],
          visible: true,
        },
      ],
    };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:mask-before-final',
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: session.generation,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: {
        graphIdentity: 'mask-before-graph',
        id: 'mask-before-navigator',
        imageSessionId: session.id,
        url: 'blob:mask-before-navigator',
      },
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('coalesces repeated drag commits into one persistent history entry and invalidates outputs', () => {
    const identity = captureIdentity('radial-drag:1');
    const first = useEditorStore.getState().applyEditTransaction(
      buildSubMaskInteractionEditTransaction(useEditorStore.getState(), identity, maskSubId, {
        parameters: { centerX: 130, centerY: 220, feather: 0.5, radiusX: 40, radiusY: 30, rotation: 0 },
      }),
    );
    const second = useEditorStore.getState().applyEditTransaction(
      buildSubMaskInteractionEditTransaction(useEditorStore.getState(), identity, maskSubId, {
        parameters: { centerX: 160, centerY: 250, feather: 0.5, radiusX: 40, radiusY: 30, rotation: 0 },
      }),
    );
    const state = useEditorStore.getState();

    expect(first).toMatchObject({ changedKeys: ['masks'], nextAdjustmentRevision: 1, noOp: false });
    expect(second).toMatchObject({ changedKeys: ['masks'], nextAdjustmentRevision: 2, noOp: false });
    expect(state.adjustmentSnapshot.value.masks[0]?.subMasks[0]?.parameters).toMatchObject({
      centerX: 160,
      centerY: 250,
    });
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
    expect(state.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 2,
      baseAdjustmentRevision: 0,
      imageSessionId: session.id,
      persistence: 'commit',
      source: 'layer-command',
      transactionId: identity.transactionId,
    });
    expect(state.finalPreviewUrl).toBeNull();
    expect(state.navigatorPreviewArtifact).toBeNull();

    state.undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.masks[0]?.subMasks[0]?.parameters).toMatchObject({
      centerX: 100,
      centerY: 200,
    });
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(0.4);
  });

  test('makes an older interaction stale after a successor starts and commits', () => {
    const firstIdentity = captureIdentity('radial-drag:first');
    useEditorStore
      .getState()
      .applyEditTransaction(
        buildSubMaskInteractionEditTransaction(useEditorStore.getState(), firstIdentity, maskSubId, { opacity: 80 }),
      );
    const successorIdentity = captureIdentity('radial-drag:successor');
    useEditorStore.getState().applyEditTransaction(
      buildSubMaskInteractionEditTransaction(useEditorStore.getState(), successorIdentity, maskSubId, {
        opacity: 70,
      }),
    );
    const beforeStale = useEditorStore.getState();

    expect(() =>
      buildSubMaskInteractionEditTransaction(beforeStale, firstIdentity, maskSubId, { opacity: 60 }),
    ).toThrow('sub_mask_interaction.stale_identity');
    const afterStale = useEditorStore.getState();
    expect(afterStale.adjustmentSnapshot.value).toBe(beforeStale.adjustmentSnapshot.value);
    expect(afterStale.history).toBe(beforeStale.history);
    expect(afterStale.adjustmentRevision).toBe(2);
  });

  test('ends after the final synchronous commit and ignores late overlay updates', async () => {
    const slot = { current: captureIdentity('radial-drag:end') };
    const appliedIds: string[] = [];
    const applyIfActive = (id: string): void => {
      if (slot.current !== null) appliedIds.push(id);
    };

    scheduleSubMaskInteractionEnd(slot);
    applyIfActive('final-sync-commit');
    await Promise.resolve();
    applyIfActive('late-post-end-update');

    expect(appliedIds).toEqual(['final-sync-commit']);
    expect(slot.current).toBeNull();
  });

  test('does not clear a successor when an older end callback drains', async () => {
    const slot = { current: captureIdentity('radial-drag:ended') };
    scheduleSubMaskInteractionEnd(slot);
    const successor = captureIdentity('radial-drag:successor-before-drain');
    slot.current = successor;
    await Promise.resolve();
    expect(slot.current).toBe(successor);
  });

  test('rejects stale session, path, and revision identities before mutation', () => {
    const identity = captureIdentity('radial-drag:stale');
    const before = useEditorStore.getState();
    expect(() =>
      buildSubMaskInteractionEditTransaction(before, { ...identity, imageSessionId: 'successor-session' }, maskSubId, {
        opacity: 60,
      }),
    ).toThrow('sub_mask_interaction.stale_identity');
    expect(() =>
      buildSubMaskInteractionEditTransaction(before, { ...identity, sourceIdentity: '/fixture/other.ARW' }, maskSubId, {
        opacity: 60,
      }),
    ).toThrow('sub_mask_interaction.stale_identity');
    expect(() =>
      buildSubMaskInteractionEditTransaction(
        { ...before, adjustmentRevision: identity.adjustmentRevision + 1 },
        identity,
        maskSubId,
        { opacity: 60 },
      ),
    ).toThrow('sub_mask_interaction.stale_identity');
    expect(useEditorStore.getState().adjustmentSnapshot.value).toBe(before.adjustmentSnapshot.value);
    expect(useEditorStore.getState().history).toBe(before.history);
  });

  test('rejects moved, replaced, and duplicate target identities without mutation', () => {
    const identity = captureIdentity('radial-drag:target');
    const before = useEditorStore.getState();
    const originalContainer = before.adjustmentSnapshot.value.masks[0];
    if (originalContainer === undefined) throw new Error('expected mask container');
    const originalSubMask = originalContainer.subMasks[0];
    if (originalSubMask === undefined) throw new Error('expected submask');
    const movedAdjustments = {
      ...before.adjustmentSnapshot.value,
      masks: [{ ...originalContainer, id: 'layer:successor' }],
    };
    const movedState = {
      ...before,
      adjustmentSnapshot: { ...before.adjustmentSnapshot, value: movedAdjustments },
    };
    expect(() => buildSubMaskInteractionEditTransaction(movedState, identity, maskSubId, { opacity: 60 })).toThrow(
      'sub_mask_interaction.stale_target',
    );

    const duplicateAdjustments = {
      ...before.adjustmentSnapshot.value,
      masks: [originalContainer, structuredClone(originalContainer)],
    };
    const duplicateState = {
      ...before,
      adjustmentSnapshot: { ...before.adjustmentSnapshot, value: duplicateAdjustments },
    };
    expect(() => buildSubMaskInteractionEditTransaction(duplicateState, identity, maskSubId, { opacity: 60 })).toThrow(
      'sub_mask_interaction.stale_target',
    );

    const duplicateSubMaskAdjustments = {
      ...before.adjustmentSnapshot.value,
      masks: [
        {
          ...originalContainer,
          subMasks: [originalSubMask, structuredClone(originalSubMask)],
        },
      ],
    };
    const duplicateSubMaskState = {
      ...before,
      adjustmentSnapshot: { ...before.adjustmentSnapshot, value: duplicateSubMaskAdjustments },
    };
    expect(() =>
      buildSubMaskInteractionEditTransaction(duplicateSubMaskState, identity, maskSubId, { opacity: 60 }),
    ).toThrow('sub_mask_interaction.stale_target');
    expect(useEditorStore.getState().adjustmentSnapshot.value).toBe(before.adjustmentSnapshot.value);
    expect(useEditorStore.getState().history).toBe(before.history);
  });

  test('treats an exact patch as a no-op without history or output invalidation', () => {
    const identity = captureIdentity('radial-drag:no-op');
    const before = useEditorStore.getState();
    const currentParameters = before.adjustmentSnapshot.value.masks[0]?.subMasks[0]?.parameters;
    if (currentParameters === undefined) throw new Error('Expected current sub-mask parameters.');
    const result = before.applyEditTransaction(
      buildSubMaskInteractionEditTransaction(before, identity, maskSubId, {
        parameters: currentParameters,
      }),
    );
    const after = useEditorStore.getState();

    expect(result).toMatchObject({ changedKeys: [], nextAdjustmentRevision: 0, noOp: true });
    expect(after.history).toBe(before.history);
    expect(after.adjustmentRevision).toBe(0);
    expect(after.finalPreviewUrl).toBe('blob:mask-before-final');
    expect(after.navigatorPreviewArtifact).toBe(before.navigatorPreviewArtifact);
  });

  test('targets AI-patch submasks through the source-artifacts node', () => {
    const identity = captureSubMaskInteractionIdentity(useEditorStore.getState(), 'quick-erase-drag:1', {
      containerId: 'patch:1',
      containerKind: 'aiPatches',
      subMaskId: aiSubId,
    });
    if (identity === null) throw new Error('expected AI-patch interaction identity');
    const request = buildSubMaskInteractionEditTransaction(useEditorStore.getState(), identity, aiSubId, {
      parameters: { feather: 0.4, points: [{ x: 10, y: 20 }] },
    });
    expect(request.operations).toEqual([
      expect.objectContaining({
        nodeType: 'source_artifacts',
        patch: expect.objectContaining({ aiPatches: expect.any(Array) }),
      }),
    ]);
    const result = useEditorStore.getState().applyEditTransaction(request);
    expect(result).toMatchObject({ changedKeys: ['aiPatches'], noOp: false });
    expect(result.after.aiPatches[0]?.subMasks[0]?.parameters).toEqual({
      feather: 0.4,
      points: [{ x: 10, y: 20 }],
    });
  });

  test('rejects missing selection targets without mutating editor state', () => {
    const identity = captureIdentity('radial-drag:missing');
    const before = useEditorStore.getState();
    expect(() => buildSubMaskInteractionEditTransaction(before, identity, null, { opacity: 50 })).toThrow(
      'sub_mask_interaction.missing_id',
    );
    expect(() => buildSubMaskInteractionEditTransaction(before, identity, 'missing', { opacity: 50 })).toThrow(
      'sub_mask_interaction.stale_target',
    );
    expect(useEditorStore.getState().adjustmentSnapshot.value).toBe(before.adjustmentSnapshot.value);
  });
});
