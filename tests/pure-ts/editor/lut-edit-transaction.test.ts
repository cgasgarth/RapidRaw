import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildLutClearEditTransaction,
  buildLutLoadEditTransaction,
  captureLutCommitIdentity,
  type LutCommitIdentity,
} from '../../../src/utils/lutEditTransaction';

const sourcePath = '/fixture/lut-controls.ARW';
const session = createEditorImageSession({ generation: 22, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<LutCommitIdentity> = {}): LutCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('LUT edit transaction', () => {
  beforeEach(() => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure: 0.4,
      effectsEnabled: false,
    };
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

  test('loads complete LUT identity without changing Effects enablement and restores the prior state on Undo', () => {
    const state = useEditorStore.getState();
    const request = buildLutLoadEditTransaction(
      state,
      identity(),
      { data: null, intensity: 100, name: 'warm.cube', path: '/luts/warm.cube', size: 33 },
      'lut-load',
    );
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'display_creative',
        patch: {
          lutData: null,
          lutIntensity: 100,
          lutName: 'warm.cube',
          lutPath: '/luts/warm.cube',
          lutSize: 33,
        },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result.after).toMatchObject({ lutName: 'warm.cube', lutPath: '/luts/warm.cube', lutSize: 33 });
    expect(result.after.effectsEnabled).toBeFalse();
    expect(result.afterEditDocumentV2.nodes['display_creative']?.enabled).toBeFalse();
    expect(result.afterEditDocumentV2.nodes['display_creative']?.params).toMatchObject({
      lutIntensity: 100,
      lutName: 'warm.cube',
      lutPath: '/luts/warm.cube',
      lutSize: 33,
    });
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value).toMatchObject({
      lutName: null,
      lutPath: null,
      lutSize: 0,
    });
    expect(useEditorStore.getState().adjustmentSnapshot.value.effectsEnabled).toBeFalse();
  });

  test('clears complete LUT identity in one node revision and Undo restores it', () => {
    const loaded = {
      ...useEditorStore.getState().adjustmentSnapshot.value,
      lutIntensity: 47,
      lutName: 'loaded.cube',
      lutPath: '/luts/loaded.cube',
      lutSize: 17,
    };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(loaded);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
    });

    const state = useEditorStore.getState();
    const result = state.applyEditTransaction(buildLutClearEditTransaction(state, identity(), 'lut-clear'));
    expect(result.after).toMatchObject({ lutData: null, lutIntensity: 100, lutName: null, lutPath: null, lutSize: 0 });
    expect(result.afterEditDocumentV2.nodes['display_creative']?.params).toMatchObject({
      lutData: null,
      lutIntensity: 100,
      lutName: null,
      lutPath: null,
      lutSize: 0,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value).toMatchObject({
      lutIntensity: 47,
      lutName: 'loaded.cube',
      lutPath: '/luts/loaded.cube',
      lutSize: 17,
    });
  });

  test('captures identity and fails closed for stale async load completions and exact clear no-ops', () => {
    const state = useEditorStore.getState();
    expect(captureLutCommitIdentity(state)).toEqual(identity());
    expect(() =>
      buildLutLoadEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/other.ARW' }),
        { data: null, intensity: 100, name: 'stale.cube', path: '/luts/stale.cube', size: 17 },
        'stale-source',
      ),
    ).toThrow('lut_transaction.stale_source');
    expect(() => buildLutClearEditTransaction(state, identity({ adjustmentRevision: 1 }), 'stale-revision')).toThrow(
      'lut_transaction.stale_revision',
    );

    const noOp = state.applyEditTransaction(buildLutClearEditTransaction(state, identity(), 'clear-no-op'));
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
  });
});
