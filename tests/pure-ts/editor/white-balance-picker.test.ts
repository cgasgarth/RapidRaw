import { beforeEach, describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildTechnicalWhiteBalance } from '../../../src/utils/color/whiteBalance';
import {
  analyzeWhiteBalancePickerRgbaSample,
  applyWhiteBalancePickerHoverPreview,
  averageWhiteBalancePickerRgbaSample,
  buildWhiteBalancePickerAdjustmentCommand,
  buildWhiteBalancePickerEditTransaction,
  calculateWhiteBalancePickerAdjustment,
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
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments),
      adjustments,
      finalPreviewUrl: null,
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      isWbPickerActive: false,
      lastEditApplicationReceipt: null,
      lastWhiteBalancePickerReceipt: null,
      selectedImage: null,
      transformedOriginalUrl: null,
      uncroppedAdjustedPreviewUrl: null,
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
    const currentAdjustments = { ...INITIAL_ADJUSTMENTS, temperature: 8, tint: -4 };
    const averageRgb = { blue: 170, green: 130, red: 96 };
    const expectedAdjustment = calculateWhiteBalancePickerAdjustment({
      currentTemperature: currentAdjustments.temperature,
      currentTint: currentAdjustments.tint,
      sample: averageRgb,
    });

    const command = buildWhiteBalancePickerAdjustmentCommand({
      averageRgb,
      coordinates: { imageX: 128.25, imageY: 64.5, previewPixelX: 257, previewPixelY: 129 },
      currentAdjustments,
      previewIdentity: 'blob:runtime-preview-4746',
      selectedImagePath: '/Users/cgas/Pictures/Capture One/Alaska/sample.RAF',
    });

    expect(command.nextAdjustments.temperature).toBe(expectedAdjustment.temperature);
    expect(command.nextAdjustments.tint).toBe(expectedAdjustment.tint);
    expect(command.nextAdjustments.whiteBalanceTechnical.mode).toBe('chromaticity');
    expect(command.nextAdjustments.whiteBalanceTechnical.source).toBe('picker');
    expect(command.nextAdjustments.exposure).toBe(currentAdjustments.exposure);
    expect(command.receipt).toMatchObject({
      algorithm: 'neutral_patch_scene_linear_chromaticity_v1',
      averageRgb,
      coordinates: { imageX: 128.25, imageY: 64.5, previewPixelX: 257, previewPixelY: 129 },
      previewIdentity: 'blob:runtime-preview-4746',
      resultingTemperature: expectedAdjustment.temperature,
      resultingTint: expectedAdjustment.tint,
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
      currentAdjustments: INITIAL_ADJUSTMENTS,
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
    const initial = { ...INITIAL_ADJUSTMENTS, temperature: 3, tint: -2 };
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, initial),
      adjustments: initial,
      finalPreviewUrl: 'blob:stale-before-picker',
      history: [initial],
      historyIndex: 0,
      isWbPickerActive: true,
      selectedImage: selectedImageFor('/tmp/alaska-raw.NEF'),
      uncroppedAdjustedPreviewUrl: 'blob:stale-before-picker-uncropped',
    });

    const command = buildWhiteBalancePickerAdjustmentCommand({
      averageRgb: { blue: 92, green: 134, red: 184 },
      coordinates: { imageX: 20, imageY: 30, previewPixelX: 40, previewPixelY: 60 },
      currentAdjustments: initial,
      previewIdentity: 'blob:displayed-preview-clicked',
      selectedImagePath: '/tmp/alaska-raw.NEF',
    });

    const editor = useEditorStore.getState();
    const transaction = buildWhiteBalancePickerEditTransaction(
      editor,
      command.receipt,
      command.nextAdjustments,
      'white-balance-picker-commit',
    );
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
    expect(state.adjustments.temperature).toBe(command.receipt.resultingTemperature);
    expect(state.adjustments.tint).toBe(command.receipt.resultingTint);
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
    expect(state.adjustments.temperature).toBe(initial.temperature);
    expect(state.adjustments.tint).toBe(initial.tint);

    useEditorStore.getState().redo();
    state = useEditorStore.getState();
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
    expect(state.adjustments.temperature).toBe(command.receipt.resultingTemperature);
    expect(state.adjustments.tint).toBe(command.receipt.resultingTint);
  });

  test('preserves exact no-ops and rejects stale source and revision identities', () => {
    const imagePath = '/tmp/current-picker-source.ARW';
    useEditorStore.setState({ selectedImage: selectedImageFor(imagePath) });
    const command = buildWhiteBalancePickerAdjustmentCommand({
      averageRgb: { blue: 120, green: 120, red: 120 },
      coordinates: { imageX: 1, imageY: 2, previewPixelX: 3, previewPixelY: 4 },
      currentAdjustments: useEditorStore.getState().adjustments,
      previewIdentity: 'blob:picker-current',
      selectedImagePath: imagePath,
    });
    const state = useEditorStore.getState();
    const noOpRequest = buildWhiteBalancePickerEditTransaction(
      state,
      command.receipt,
      state.adjustments,
      'picker-no-op',
    );
    const noOp = state.applyEditTransaction(noOpRequest);
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    expect(() =>
      buildWhiteBalancePickerEditTransaction(
        state,
        { ...command.receipt, selectedImagePath: '/tmp/stale-picker-source.ARW' },
        command.nextAdjustments,
        'picker-stale-source',
      ),
    ).toThrow('white_balance_picker_stale_source:/tmp/stale-picker-source.ARW:/tmp/current-picker-source.ARW');

    const stale = buildWhiteBalancePickerEditTransaction(
      state,
      command.receipt,
      command.nextAdjustments,
      'picker-stale-revision',
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
    expect(useEditorStore.getState().adjustments.whiteBalanceTechnical.source).not.toBe('picker');
  });

  test('hover preview is history-free, cancellable, and source-revision safe', () => {
    const base = { ...INITIAL_ADJUSTMENTS, exposure: 0.25 };
    const previewAdjustments = {
      ...base,
      whiteBalanceTechnical: buildTechnicalWhiteBalance('chromaticity', 4100, 0.01),
    };
    let session = createWhiteBalancePickerPreviewSession(base, 'source:a');
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, base),
      adjustments: base,
      history: [base],
      historyIndex: 0,
    });

    const preview = applyWhiteBalancePickerHoverPreview(session, previewAdjustments, {
      previewIdentity: 'preview:1',
      selectedImagePath: 'source:a',
    });
    session = preview.session;
    useEditorStore.getState().publishWhiteBalancePickerPreview(preview.adjustments);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();
    expect(useEditorStore.getState().adjustments.whiteBalanceTechnical.mode).toBe('chromaticity');

    expect(session.lastPreviewIdentity).toBe('preview:1');
    useEditorStore.getState().publishWhiteBalancePickerPreview(cancelWhiteBalancePickerPreview(session, 'source:a'));
    expect(useEditorStore.getState().adjustments).toEqual(base);
    expect(() =>
      applyWhiteBalancePickerHoverPreview(session, previewAdjustments, {
        previewIdentity: 'preview:2',
        selectedImagePath: 'source:b',
      }),
    ).toThrow('white_balance_picker_stale_preview');
    expect(() => cancelWhiteBalancePickerPreview(session, 'source:b')).toThrow('white_balance_picker_stale_preview');
  });
});
