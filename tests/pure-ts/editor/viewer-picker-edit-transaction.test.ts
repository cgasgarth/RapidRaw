import { beforeEach, describe, expect, test } from 'bun:test';

import type { ViewerPickerCommitResult } from '../../../src/components/panel/editor/viewerPickerInteractionControllers';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { buildViewerPickerEditTransaction } from '../../../src/utils/viewerPickerEditTransaction';

const sourcePath = '/fixture/viewer-picker.ARW';
const sourceRevision = 'viewer-graph:17';
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
const pointResult = {
  chroma: 0.22,
  confidence: 0.94,
  graphFingerprint: 'picker-graph-fingerprint',
  graphRevision: sourceRevision,
  hueDegrees: 205,
  lightness: 0.43,
  sampleRadiusPx: 8,
  sourceFingerprint: 'picker-source-fingerprint',
  sourceIdentity: sourcePath,
};
const toneResult = {
  contributingWeights: [0, 0, 0.1, 0.3, 1, 0.3, 0.1, 0, 0],
  exposureEv: 0.25,
  graphFingerprint: '1234567890abcdef',
  graphRevision: sourceRevision,
  primaryBand: 4,
  sourceFingerprint: 'abcdef1234567890',
  sourceIdentity: sourcePath,
};

const currentTransactionState = () => ({
  ...useEditorStore.getState(),
  geometryEpoch: 9,
  sourceRevision,
});

const pointCommand = (
  overrides: Partial<Extract<ViewerPickerCommitResult, { kind: 'point-color' }>['key']> = {},
): Extract<ViewerPickerCommitResult, { kind: 'point-color' }> => ({
  key: {
    adjustmentRevision: 0,
    geometryEpoch: 9,
    imageSessionId: session.id,
    normalizedImagePoint: { x: 0.25, y: 0.75 },
    operationGeneration: 3,
    sourceIdentity: sourcePath,
    sourceRevision,
    toolId: 'point-color',
    ...overrides,
  },
  kind: 'point-color',
  ordinal: 1,
  result: pointResult,
});

const toneCommand = (
  baseline = createDefaultEditDocumentV2(),
  overrides: Partial<Extract<ViewerPickerCommitResult, { kind: 'tone-equalizer' }>['key']> = {},
): Extract<ViewerPickerCommitResult, { kind: 'tone-equalizer' }> => ({
  baseline,
  deltaEv: 1,
  key: {
    adjustmentRevision: 0,
    geometryEpoch: 9,
    imageSessionId: session.id,
    normalizedImagePoint: { x: 0.6, y: 0.4 },
    operationGeneration: 4,
    sourceIdentity: sourcePath,
    sourceRevision,
    toolId: 'tone-equalizer',
    ...overrides,
  },
  kind: 'tone-equalizer',
  result: toneResult,
});

describe('viewer picker edit transaction', () => {
  beforeEach(() => {
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:picker-before',
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: 17,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('commits Point Color through one picker transaction and restores it through Undo and Redo', () => {
    const ids = ['point-id', 'sample-id'];
    const request = buildViewerPickerEditTransaction(
      currentTransactionState(),
      pointCommand(),
      'viewer-picker:point-color:1',
      () => ids.shift() ?? 'unexpected',
    );
    const result = useEditorStore.getState().applyEditTransaction(request);

    expect(request).toMatchObject({ history: 'single-entry', persistence: 'commit', source: 'picker' });
    expect(result).toMatchObject({
      changedKeys: ['pointColor'],
      invalidatedStages: ['preview', 'navigator', 'thumbnail'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(result.after.pointColor).toMatchObject({
      enabled: true,
      selectedPointId: 'point-id',
      points: [{ id: 'point-id', samples: [{ id: 'sample-id' }] }],
    });
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 1,
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: session.id,
        persistence: 'commit',
        source: 'picker',
        transactionId: 'viewer-picker:point-color:1',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'point_color').params['pointColor'].points,
    ).toEqual([]);
    useEditorStore.getState().redo();
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'point_color').params['pointColor'].points[0]
        ?.id,
    ).toBe('point-id');
  });

  test('commits Tone Equalizer through fallback session authority and keeps an exact no-op inert', () => {
    useEditorStore.setState({ imageSession: null, imageSessionId: 51 });
    const fallbackSessionId = 'editor-image-session:51';
    const command = toneCommand(createDefaultEditDocumentV2(), { imageSessionId: fallbackSessionId });
    const result = useEditorStore
      .getState()
      .applyEditTransaction(
        buildViewerPickerEditTransaction(currentTransactionState(), command, 'viewer-picker:tone:1'),
      );
    expect(result).toMatchObject({ changedKeys: ['toneEqualizer'], nextAdjustmentRevision: 1, noOp: false });
    expect(result.after.toneEqualizer).toMatchObject({ enabled: true, previewMode: 2, selectedBand: 4 });
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      imageSessionId: fallbackSessionId,
      source: 'picker',
    });

    const state = currentTransactionState();
    const noOpCommand = {
      ...toneCommand(structuredClone(state.editDocumentV2), {
        adjustmentRevision: 1,
        imageSessionId: fallbackSessionId,
        operationGeneration: 5,
      }),
      deltaEv: 0,
    };
    const noOp = useEditorStore
      .getState()
      .applyEditTransaction(buildViewerPickerEditTransaction(state, noOpCommand, 'viewer-picker:tone:no-op'));
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 1, historyIndex: 1 });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt?.transactionId).toBe('viewer-picker:tone:1');
  });

  test('fails closed across every authoritative identity and native-receipt dimension', () => {
    const staleCommands: ViewerPickerCommitResult[] = [
      pointCommand({ adjustmentRevision: 1 }),
      pointCommand({ imageSessionId: 'image-session:successor' }),
      pointCommand({ sourceIdentity: '/fixture/B.ARW' }),
      pointCommand({ sourceRevision: 'viewer-graph:18' }),
      pointCommand({ geometryEpoch: 10 }),
      pointCommand({ operationGeneration: 0 }),
      pointCommand({ normalizedImagePoint: { x: -0.1, y: 0.5 } }),
    ];
    for (const command of staleCommands) {
      expect(() => buildViewerPickerEditTransaction(currentTransactionState(), command, 'stale')).toThrow(
        'viewer_picker_transaction.',
      );
    }
    expect(() =>
      buildViewerPickerEditTransaction(
        currentTransactionState(),
        { ...pointCommand(), result: { ...pointResult, graphRevision: 'viewer-graph:18' } },
        'stale-native-revision',
      ),
    ).toThrow('viewer_picker_transaction.stale_native_revision');
    expect(() =>
      buildViewerPickerEditTransaction(
        currentTransactionState(),
        { ...pointCommand(), result: { ...pointResult, sourceIdentity: '/fixture/B.ARW' } },
        'stale-native-source',
      ),
    ).toThrow('viewer_picker_transaction.stale_native_source');
  });
});
