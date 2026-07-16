import { beforeEach, describe, expect, test } from 'bun:test';

import { editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createEditDocumentPresetPayload } from '../../../src/utils/editDocumentPreset';
import {
  copyEditDocumentV2Node,
  createDefaultEditDocumentV2,
  patchEditDocumentV2Node,
  resetEditDocumentV2Node,
} from '../../../src/utils/editDocumentV2';
import {
  buildRawProcessingModeOverrideEditTransaction,
  type RawProcessingModeOverrideCommitIdentity,
  selectRawProcessingModeOverride,
} from '../../../src/utils/rawProcessingModeOverrideEditTransaction';

const sourcePath = '/fixture/source-decode.ARW';
const session = createEditorImageSession({ generation: 63, path: sourcePath, source: 'cache' });
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
const identity = (
  overrides: Partial<RawProcessingModeOverrideCommitIdentity> = {},
): RawProcessingModeOverrideCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('raw processing mode override edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = createDefaultEditDocumentV2();
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

  test('commits one source-decode node revision and lowers the matching flat projection', () => {
    const state = useEditorStore.getState();
    const request = buildRawProcessingModeOverrideEditTransaction(state, identity(), 'maximum', 'decode-maximum');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'source_decode',
        patch: { rawProcessingModeOverride: 'maximum' },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['nodes.source_decode.params.rawProcessingModeOverride'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(result.after.sourceDecode.rawProcessingModeOverride).toBe('maximum');
    expect(result.after.sourceDecode.rawProcessingModeOverride).toBe('maximum');
    expect(selectRawProcessingModeOverride(result.after)).toBe('maximum');
    expect(result.after.nodes['scene_global_color_tone']).toBe(result.before.nodes['scene_global_color_tone']);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.sourceDecode.rawProcessingModeOverride).toBeNull();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().editDocumentV2.sourceDecode.rawProcessingModeOverride).toBe('maximum');
  });

  test('supports inherit/reset but excludes source-decode state from copy and presets', () => {
    const source = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'source_decode', {
      rawProcessingModeOverride: 'fast',
    });
    const reset = resetEditDocumentV2Node(source, 'source_decode');
    expect(selectRawProcessingModeOverride(reset)).toBeNull();
    expect(copyEditDocumentV2Node(source, 'source_decode')).toBeNull();
    expect(createEditDocumentPresetPayload(source, true, 'style').nodes).not.toHaveProperty('source_decode');
  });

  test('rejects invalid values, stale identity, disabled nodes, and split domain authority', () => {
    const state = useEditorStore.getState();
    expect(() => buildRawProcessingModeOverrideEditTransaction(state, identity(), 'ultra', 'decode-invalid')).toThrow();
    expect(() =>
      buildRawProcessingModeOverrideEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        'fast',
        'decode-stale',
      ),
    ).toThrow('raw_processing_mode_override_transaction.stale_source');

    const document = createDefaultEditDocumentV2();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: { ...document.nodes, source_decode: { ...document.nodes['source_decode'], enabled: false } },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({ ...document, sourceDecode: { rawProcessingModeOverride: 'fast' } }),
    ).toThrow('Source-decode domain disagrees');
  });
});
