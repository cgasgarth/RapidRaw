import { beforeEach, describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  analyzeWhiteBalancePickerRgbaSample,
  applyWhiteBalancePickerAdjustmentCommand,
  applyWhiteBalancePickerHoverPreview,
  averageWhiteBalancePickerRgbaSample,
  buildWhiteBalancePickerAdjustmentCommand,
  buildWhiteBalancePickerEditTransaction,
  cancelWhiteBalancePickerPreview,
  createWhiteBalancePickerPreviewSession,
} from '../../../src/utils/whiteBalancePicker';

const selectedImageFor = (path: string) => ({
  exif: null,
  height: 1200,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 1800,
});

describe('white balance picker runtime command path', () => {
  beforeEach(() => {
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      finalPreviewUrl: null,
      historyCheckpoints: [],
      historyIndex: 0,
      isWbPickerActive: false,
      lastEditApplicationReceipt: null,
      lastWhiteBalancePickerReceipt: null,
      selectedImage: null,
      transformedOriginalUrl: null,
      uncroppedAdjustedPreviewUrl: null,
      editDocumentV2,
      history: [editDocumentV2],
    });
  });

  test('averages sampled RGBA pixels deterministically', () => {
    const sample = averageWhiteBalancePickerRgbaSample(
      new Uint8ClampedArray([120, 128, 136, 255, 90, 100, 110, 255, 210, 200, 190, 255]),
    );

    expect(sample).toEqual({
      blue: 436 / 3,
      green: 428 / 3,
      red: 420 / 3,
    });
  });

  test('builds an adjustment receipt tied to the sampled preview identity', () => {
    const currentDocument = createDefaultEditDocumentV2();
    const averageRgb = { blue: 170, green: 130, red: 96 };

    const command = buildWhiteBalancePickerAdjustmentCommand({
      averageRgb,
      coordinates: { imageX: 128.25, imageY: 64.5, previewPixelX: 257, previewPixelY: 129 },
      previewIdentity: 'blob:runtime-preview-4746',
      selectedImagePath: '/Users/cgas/Pictures/Capture One/Alaska/sample.RAF',
    });

    expect(command.patch.whiteBalanceTechnical.mode).toBe('chromaticity');
    expect(command.patch.whiteBalanceTechnical.source).toBe('picker');
    const applied = applyWhiteBalancePickerAdjustmentCommand(currentDocument, command);
    expect(selectEditDocumentNode(applied, 'scene_global_color_tone')).toBe(
      selectEditDocumentNode(currentDocument, 'scene_global_color_tone'),
    );
    expect(command.receipt).toMatchObject({
      algorithm: 'neutral_patch_scene_linear_chromaticity_v1',
      averageRgb,
      coordinates: { imageX: 128.25, imageY: 64.5, previewPixelX: 257, previewPixelY: 129 },
      previewIdentity: 'blob:runtime-preview-4746',
      resultingDuv: command.patch.whiteBalanceTechnical.duv,
      resultingKelvin: command.patch.whiteBalanceTechnical.kelvin,
      selectedImagePath: '/Users/cgas/Pictures/Capture One/Alaska/sample.RAF',
    });
    expect(command.receipt.confidence).toBeGreaterThanOrEqual(0);
    expect(command.receipt.estimatedKelvin).toBeGreaterThanOrEqual(1667);
  });

  test('records patch statistics and rejects clipped, mixed, and stale samples', () => {
    const uniform = analyzeWhiteBalancePickerRgbaSample(
      new Uint8ClampedArray([120, 130, 140, 255, 122, 131, 139, 255, 121, 129, 141, 255]),
    );
    expect(uniform).not.toBeNull();
    expect(uniform?.patchPixelCount).toBe(3);
    expect(uniform?.spatialVariance).toBeLessThan(0.001);

    const base = {
      coordinates: { imageX: 1, imageY: 2, previewPixelX: 3, previewPixelY: 4 },
      previewIdentity: 'preview:new',
      selectedImagePath: '/tmp/source.raw',
    };
    expect(() =>
      buildWhiteBalancePickerAdjustmentCommand({
        ...base,
        averageRgb: { red: 120, green: 130, blue: 140 },
        currentPreviewIdentity: 'preview:old',
      }),
    ).toThrow('white_balance_picker_stale_preview');
    expect(() =>
      buildWhiteBalancePickerAdjustmentCommand({
        ...base,
        averageRgb: { red: 120, green: 130, blue: 140 },
        patchPixelCount: 10,
        rejectedClippedPixels: 2,
      }),
    ).toThrow('white_balance_picker_clipped_patch');
    expect(() =>
      buildWhiteBalancePickerAdjustmentCommand({
        ...base,
        averageRgb: { red: 120, green: 130, blue: 140 },
        patchPixelCount: 121,
        spatialVariance: 0.03,
      }),
    ).toThrow('white_balance_picker_non_uniform_patch');
  });

  test('commits one undoable picker adjustment and preserves receipt data for QA', () => {
    const initial = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:stale-before-picker',
      historyIndex: 0,
      isWbPickerActive: true,
      selectedImage: selectedImageFor('/tmp/alaska-raw.NEF'),
      uncroppedAdjustedPreviewUrl: 'blob:stale-before-picker-uncropped',
      editDocumentV2: initial,
      history: [initial],
    });

    const command = buildWhiteBalancePickerAdjustmentCommand({
      averageRgb: { blue: 92, green: 134, red: 184 },
      coordinates: { imageX: 20, imageY: 30, previewPixelX: 40, previewPixelY: 60 },
      previewIdentity: 'blob:displayed-preview-clicked',
      selectedImagePath: '/tmp/alaska-raw.NEF',
    });

    const editor = useEditorStore.getState();
    const transaction = buildWhiteBalancePickerEditTransaction(editor, command, 'white-balance-picker-commit');
    expect(transaction.operations).toEqual([
      {
        nodeType: 'camera_input',
        patch: {
          whiteBalanceTechnical: command.patch.whiteBalanceTechnical,
        },
        type: 'patch-edit-document-node',
      },
    ]);
    const result = editor.applyEditTransaction(transaction);
    editor.setEditor({ isWbPickerActive: false, lastWhiteBalancePickerReceipt: command.receipt });

    let state = useEditorStore.getState();
    expect(result).toMatchObject({
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'picker',
      transactionId: 'white-balance-picker-commit',
    });
    expect(state.adjustmentRevision).toBe(1);
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
    expect(selectEditDocumentNode(state.editDocumentV2, 'camera_input').params['whiteBalanceTechnical'].kelvin).toBe(
      command.receipt.resultingKelvin,
    );
    expect(selectEditDocumentNode(state.editDocumentV2, 'camera_input').params['whiteBalanceTechnical'].duv).toBe(
      command.receipt.resultingDuv,
    );
    expect(result.after.nodes['camera_input']?.params['whiteBalanceTechnical']).toMatchObject({
      mode: 'chromaticity',
      source: 'picker',
    });
    expect(result.afterEditDocumentV2.nodes['geometry']).toBe(result.beforeEditDocumentV2.nodes['geometry']);
    expect(state.finalPreviewUrl).toBeNull();
    expect(state.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      baseAdjustmentRevision: 0,
      persistence: 'commit',
      source: 'picker',
    });
    expect(state.lastWhiteBalancePickerReceipt?.previewIdentity).toBe('blob:displayed-preview-clicked');

    useEditorStore.getState().undo();
    state = useEditorStore.getState();
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(0);
    expect(selectEditDocumentNode(state.editDocumentV2, 'camera_input').params['whiteBalanceTechnical']).toEqual(
      selectEditDocumentNode(initial, 'camera_input').params['whiteBalanceTechnical'],
    );

    useEditorStore.getState().redo();
    state = useEditorStore.getState();
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
    expect(selectEditDocumentNode(state.editDocumentV2, 'camera_input').params['whiteBalanceTechnical'].kelvin).toBe(
      command.receipt.resultingKelvin,
    );
    expect(selectEditDocumentNode(state.editDocumentV2, 'camera_input').params['whiteBalanceTechnical'].duv).toBe(
      command.receipt.resultingDuv,
    );
  });

  test('preserves exact no-ops and rejects stale source and revision identities', () => {
    const imagePath = '/tmp/current-picker-source.ARW';
    useEditorStore.setState({ selectedImage: selectedImageFor(imagePath) });
    const command = buildWhiteBalancePickerAdjustmentCommand({
      averageRgb: { blue: 120, green: 120, red: 120 },
      coordinates: { imageX: 1, imageY: 2, previewPixelX: 3, previewPixelY: 4 },
      previewIdentity: 'blob:picker-current',
      selectedImagePath: imagePath,
    });
    const applied = applyWhiteBalancePickerAdjustmentCommand(useEditorStore.getState().editDocumentV2, command);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      historyIndex: 0,
      editDocumentV2: applied,
      history: [applied],
    });
    const state = useEditorStore.getState();
    const noOpRequest = buildWhiteBalancePickerEditTransaction(state, command, 'picker-no-op');
    const noOp = state.applyEditTransaction(noOpRequest);
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    expect(() =>
      buildWhiteBalancePickerEditTransaction(
        state,
        {
          ...command,
          receipt: { ...command.receipt, selectedImagePath: '/tmp/stale-picker-source.ARW' },
        },
        'picker-stale-source',
      ),
    ).toThrow('white_balance_picker_stale_source:/tmp/stale-picker-source.ARW:/tmp/current-picker-source.ARW');

    const stale = buildWhiteBalancePickerEditTransaction(state, command, 'picker-stale-revision');
    const whiteBalanceBeforeStaleTransaction = structuredClone(
      selectEditDocumentNode(state.editDocumentV2, 'camera_input').params['whiteBalanceTechnical'],
    );
    state.applyEditTransaction({
      baseAdjustmentRevision: 0,
      history: 'single-entry',
      imageSessionId: stale.imageSessionId,
      operations: [{ patch: { exposure: 0.25 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-edit',
    });
    expect(() => useEditorStore.getState().applyEditTransaction(stale)).toThrow('edit_transaction.stale_base:0:1');
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'camera_input').params['whiteBalanceTechnical'],
    ).toEqual(whiteBalanceBeforeStaleTransaction);
  });

  test('hover preview is history-free, cancellable, and source-revision safe', () => {
    const baseEditDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: 0.25,
    });
    let session = createWhiteBalancePickerPreviewSession(baseEditDocumentV2, 'source:a');
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      historyIndex: 0,
      editDocumentV2: baseEditDocumentV2,
      history: [baseEditDocumentV2],
    });

    const previewCommand = buildWhiteBalancePickerAdjustmentCommand({
      averageRgb: { blue: 140, green: 130, red: 120 },
      coordinates: { imageX: 1, imageY: 2, previewPixelX: 3, previewPixelY: 4 },
      previewIdentity: 'preview:1',
      selectedImagePath: 'source:a',
    });
    const preview = applyWhiteBalancePickerHoverPreview(session, previewCommand);
    session = preview.session;
    useEditorStore.getState().publishWhiteBalancePickerPreview(preview.editDocumentV2);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'camera_input').params['whiteBalanceTechnical']
        .mode,
    ).toBe('chromaticity');

    expect(session.lastPreviewIdentity).toBe('preview:1');
    useEditorStore.getState().publishWhiteBalancePickerPreview(cancelWhiteBalancePickerPreview(session, 'source:a'));
    expect(useEditorStore.getState().editDocumentV2).toEqual(baseEditDocumentV2);
    expect(() =>
      applyWhiteBalancePickerHoverPreview(session, {
        ...previewCommand,
        receipt: { ...previewCommand.receipt, previewIdentity: 'preview:2', selectedImagePath: 'source:b' },
      }),
    ).toThrow('white_balance_picker_stale_preview');
    expect(() => cancelWhiteBalancePickerPreview(session, 'source:b')).toThrow('white_balance_picker_stale_preview');
  });
});
