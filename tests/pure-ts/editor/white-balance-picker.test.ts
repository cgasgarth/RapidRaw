import { beforeEach, describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  analyzeWhiteBalancePickerRgbaSample,
  averageWhiteBalancePickerRgbaSample,
  buildWhiteBalancePickerAdjustmentCommand,
  calculateWhiteBalancePickerAdjustment,
} from '../../../src/utils/whiteBalancePicker';

describe('white balance picker runtime command path', () => {
  beforeEach(() => {
    useEditorStore.setState({
      adjustments: INITIAL_ADJUSTMENTS,
      finalPreviewUrl: null,
      history: [INITIAL_ADJUSTMENTS],
      historyCheckpoints: [],
      historyIndex: 0,
      isWbPickerActive: false,
      lastWhiteBalancePickerReceipt: null,
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
      adjustments: initial,
      finalPreviewUrl: 'blob:stale-before-picker',
      history: [initial],
      historyIndex: 0,
      isWbPickerActive: true,
      uncroppedAdjustedPreviewUrl: 'blob:stale-before-picker-uncropped',
    });

    const command = buildWhiteBalancePickerAdjustmentCommand({
      averageRgb: { blue: 92, green: 134, red: 184 },
      coordinates: { imageX: 20, imageY: 30, previewPixelX: 40, previewPixelY: 60 },
      currentAdjustments: initial,
      previewIdentity: 'blob:displayed-preview-clicked',
      selectedImagePath: '/tmp/alaska-raw.NEF',
    });

    useEditorStore.getState().setEditor({
      adjustments: command.nextAdjustments,
      finalPreviewUrl: null,
      isWbPickerActive: false,
      lastWhiteBalancePickerReceipt: command.receipt,
      transformedOriginalUrl: null,
      uncroppedAdjustedPreviewUrl: null,
    });
    useEditorStore.getState().pushHistory(command.nextAdjustments);

    let state = useEditorStore.getState();
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
    expect(state.adjustments.temperature).toBe(command.receipt.resultingTemperature);
    expect(state.adjustments.tint).toBe(command.receipt.resultingTint);
    expect(state.finalPreviewUrl).toBeNull();
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
});
