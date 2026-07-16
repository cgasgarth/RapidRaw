import { afterEach, describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../src/utils/adjustmentSnapshots';
import { createDefaultMaskEditNodes, INITIAL_ADJUSTMENTS, INITIAL_MASK_ADJUSTMENTS } from '../../src/utils/adjustments';
import { perceptualGradingFromWheelSurface } from '../../src/utils/color/perceptualGrading';
import { legacyAdjustmentsToEditDocumentV2, setEditDocumentV2NodeEnabled } from '../../src/utils/editDocumentV2';
import {
  buildAdjustmentMutationOperations,
  buildEditorSectionNodeEnablementOperations,
  buildEditTransactionPersistenceContext,
  type EditTransactionRequest,
  reduceEditTransaction,
} from '../../src/utils/editTransaction';
import { buildLayerEditTransactionRequest } from '../../src/utils/layers/layerEditTransaction';

const request = (overrides: Partial<EditTransactionRequest> = {}): EditTransactionRequest => ({
  transactionId: 'tx-1',
  imageSessionId: 'session-1',
  baseAdjustmentRevision: 4,
  source: 'manual-control',
  operations: [{ type: 'patch-adjustments', patch: { exposure: 0.5 } }],
  history: 'single-entry',
  persistence: 'commit',
  ...overrides,
});

afterEach(() => {
  const initial = structuredClone(INITIAL_ADJUSTMENTS);
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(initial);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustments: initial,
    editDocumentV2,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, initial, editDocumentV2),
    adjustmentRevision: 0,
    history: [initial],
    historyCheckpoints: [],
    historyIndex: 0,
  });
});

describe('reduceEditTransaction', () => {
  test('routes focused tone, camera, calibration, curve, tone-equalizer, point-color, lens, grading, and geometry', () => {
    const focused = buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
      ...INITIAL_ADJUSTMENTS,
      exposure: 0.5,
    });
    expect(focused).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'scene_global_color_tone',
        patch: { exposure: 0.5 },
      },
    ]);

    const geometry = buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
      ...INITIAL_ADJUSTMENTS,
      aspectRatio: 4 / 3,
      orientationSteps: 1,
    });
    expect(geometry).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'geometry',
        patch: { aspectRatio: 4 / 3, orientationSteps: 1 },
      },
    ]);

    const lensCorrection = buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
      ...INITIAL_ADJUSTMENTS,
      lensDistortionAmount: 125,
      lensVignetteEnabled: false,
    });
    expect(lensCorrection).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'lens_correction',
        patch: { lensDistortionAmount: 125, lensVignetteEnabled: false },
      },
    ]);

    const cameraInput = buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
      ...INITIAL_ADJUSTMENTS,
      cameraProfile: 'camera_neutral',
      cameraProfileAmount: 65,
    });
    expect(cameraInput).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'camera_input',
        patch: { cameraProfile: 'camera_neutral', cameraProfileAmount: 65 },
      },
    ]);

    const colorCalibration = { ...INITIAL_ADJUSTMENTS.colorCalibration, redHue: 18 };
    expect(
      buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, colorCalibration }),
    ).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'color_calibration',
        patch: { colorCalibration },
      },
    ]);

    const parametricCurve = structuredClone(INITIAL_ADJUSTMENTS.parametricCurve);
    parametricCurve.luma.highlights = 18;
    const sceneCurve = buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
      ...INITIAL_ADJUSTMENTS,
      curveMode: 'parametric',
      parametricCurve,
      toneCurve: 'soft_contrast',
    });
    expect(sceneCurve).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'scene_curve',
        patch: { curveMode: 'parametric', parametricCurve, toneCurve: 'soft_contrast' },
      },
    ]);

    const toneEqualizer = {
      ...structuredClone(INITIAL_ADJUSTMENTS.toneEqualizer),
      enabled: true,
    };
    expect(
      buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
        ...INITIAL_ADJUSTMENTS,
        toneEqualizer,
      }),
    ).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'tone_equalizer',
        patch: { toneEqualizer },
      },
    ]);

    const pointColor = { ...structuredClone(INITIAL_ADJUSTMENTS.pointColor), enabled: true };
    expect(buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, pointColor })).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'point_color',
        patch: { pointColor },
      },
    ]);

    const blackWhiteMixer = {
      ...structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer),
      enabled: true,
      process: 'continuous_sensitivity_v1' as const,
      weights: { ...INITIAL_ADJUSTMENTS.blackWhiteMixer.weights, reds: 30 },
    };
    expect(buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, blackWhiteMixer })).toEqual(
      [
        {
          type: 'patch-edit-document-node',
          nodeType: 'black_white_mixer',
          patch: { blackWhiteMixer },
        },
      ],
    );

    const channelMixer = {
      ...structuredClone(INITIAL_ADJUSTMENTS.channelMixer),
      enabled: true,
      red: { ...INITIAL_ADJUSTMENTS.channelMixer.red, green: 30 },
    };
    expect(buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, channelMixer })).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'channel_mixer',
        patch: { channelMixer },
      },
    ]);

    const colorBalanceRgb = {
      ...structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb),
      enabled: true,
      midtones: { ...INITIAL_ADJUSTMENTS.colorBalanceRgb.midtones, red: 18 },
    };
    expect(buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, colorBalanceRgb })).toEqual(
      [
        {
          type: 'patch-edit-document-node',
          nodeType: 'color_balance_rgb',
          patch: { colorBalanceRgb },
        },
      ],
    );
    const levels = { ...structuredClone(INITIAL_ADJUSTMENTS.levels), enabled: true, gamma: 1.25 };
    expect(buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, levels })).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'luma_levels',
        patch: { levels },
      },
    ]);

    const hsl = structuredClone(INITIAL_ADJUSTMENTS.hsl);
    hsl.reds.hue = 18;
    const selectiveColorRangeControls = structuredClone(INITIAL_ADJUSTMENTS.selectiveColorRangeControls);
    selectiveColorRangeControls.reds.widthDegrees = 48;
    expect(
      buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
        ...INITIAL_ADJUSTMENTS,
        hsl,
        selectiveColorRangeControls,
      }),
    ).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'selective_color_mixer',
        patch: { hsl, selectiveColorRangeControls },
      },
    ]);

    const colorGrading = { ...structuredClone(INITIAL_ADJUSTMENTS.colorGrading), balance: 20 };
    const perceptualGradingV1 = { ...perceptualGradingFromWheelSurface(colorGrading) };
    expect(
      buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
        ...INITIAL_ADJUSTMENTS,
        colorGrading,
        perceptualGradingV1,
      }),
    ).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'perceptual_grading',
        patch: { colorGrading, perceptualGradingV1 },
      },
    ]);

    const mixed = buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
      ...INITIAL_ADJUSTMENTS,
      exposure: 0.5,
      temperature: 10,
    });
    expect(mixed).toEqual([
      {
        type: 'replace-adjustments',
        adjustments: { ...INITIAL_ADJUSTMENTS, exposure: 0.5, temperature: 10 },
      },
    ]);

    expect(
      buildAdjustmentMutationOperations(INITIAL_ADJUSTMENTS, {
        ...INITIAL_ADJUSTMENTS,
        effectsEnabled: false,
      }),
    ).toEqual([{ enabled: false, nodeType: 'display_creative', type: 'set-edit-document-node-enabled' }]);
  });

  test('toggles Effects as one render-node revision while preserving latent parameters', () => {
    const before = { ...structuredClone(INITIAL_ADJUSTMENTS), grainAmount: 42 };
    const document = legacyAdjustmentsToEditDocumentV2(before);
    const result = reduceEditTransaction(
      before,
      4,
      request({
        operations: buildAdjustmentMutationOperations(before, { ...before, effectsEnabled: false }),
      }),
      undefined,
      document,
    );

    expect(result).toMatchObject({
      changedKeys: ['effectsEnabled', 'nodes.display_creative.enabled'],
      nextAdjustmentRevision: 5,
      noOp: false,
    });
    expect(result.after.effectsEnabled).toBeFalse();
    expect(result.after.grainAmount).toBe(42);
    expect(result.afterEditDocumentV2.nodes.display_creative).toMatchObject({
      enabled: false,
      params: { grainAmount: 42 },
    });
    expect(result.afterEditDocumentV2.nodes.display_creative.params).toEqual(
      result.beforeEditDocumentV2.nodes.display_creative.params,
    );
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
  });

  test('toggles every registry-owned Color node in one document-only transaction', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const operations = buildEditorSectionNodeEnablementOperations(document, 'color', false);
    const result = reduceEditTransaction(INITIAL_ADJUSTMENTS, 4, request({ operations }), undefined, document);

    expect(operations).toHaveLength(11);
    expect(result.nextAdjustmentRevision).toBe(5);
    expect(result.noOp).toBeFalse();
    expect(result.after).toBe(INITIAL_ADJUSTMENTS);
    expect(result.changedKeys).toEqual(
      operations.map((operation) =>
        operation.type === 'set-edit-document-node-enabled' ? `nodes.${operation.nodeType}.enabled` : 'unexpected',
      ),
    );
    for (const operation of operations) {
      if (operation.type === 'set-edit-document-node-enabled') {
        expect(result.afterEditDocumentV2.nodes[operation.nodeType]?.enabled).toBeFalse();
      }
    }
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone?.enabled).toBeTrue();
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
  });

  test('legacy patches preserve document-only node enablement while updating latent params', () => {
    let document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    for (const nodeType of ['scene_global_color_tone', 'scene_curve', 'detail_denoise_dehaze'] as const) {
      document = setEditDocumentV2NodeEnabled(document, nodeType, false);
    }
    const result = reduceEditTransaction(
      INITIAL_ADJUSTMENTS,
      4,
      request({ operations: [{ patch: { exposure: 1.25, vignetteAmount: -20 }, type: 'patch-adjustments' }] }),
      undefined,
      document,
    );

    expect(result.after).toMatchObject({ exposure: 1.25, vignetteAmount: -20 });
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toMatchObject({
      enabled: false,
      params: { exposure: 1.25 },
    });
    expect(result.afterEditDocumentV2.nodes.scene_curve.enabled).toBeFalse();
    expect(result.afterEditDocumentV2.nodes.detail_denoise_dehaze.enabled).toBeFalse();
    expect(result.afterEditDocumentV2.nodes.display_creative.enabled).toBeTrue();
  });

  test('typed-only authority replacement is a real revision with render invalidation', () => {
    const beforeDocument = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const afterDocument = setEditDocumentV2NodeEnabled(beforeDocument, 'scene_curve', false);
    const result = reduceEditTransaction(
      INITIAL_ADJUSTMENTS,
      4,
      request({
        operations: [
          {
            adjustments: INITIAL_ADJUSTMENTS,
            editDocumentV2: afterDocument,
            type: 'replace-edit-authority',
          },
        ],
      }),
      undefined,
      beforeDocument,
    );

    expect(result).toMatchObject({
      changedKeys: ['nodes.scene_curve.enabled'],
      nextAdjustmentRevision: 5,
      noOp: false,
    });
    expect(result.after).toEqual(INITIAL_ADJUSTMENTS);
    expect(result.afterEditDocumentV2.nodes.scene_curve.enabled).toBeFalse();
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
  });

  test('applies semantic patch operations and advances the revision once', () => {
    const result = reduceEditTransaction(INITIAL_ADJUSTMENTS, 4, request());

    expect(result.after.exposure).toBe(0.5);
    expect(result.changedKeys).toEqual(['exposure']);
    expect(result.nextAdjustmentRevision).toBe(5);
    expect(result.noOp).toBe(false);
    expect(result.applicationReceipt).toMatchObject({
      transactionId: 'tx-1',
      imageSessionId: 'session-1',
      adjustmentRevision: 5,
    });
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
    expect(result.invalidatedProvenance).toEqual(['reference-match', 'auto-edit', 'derived-render']);
    expect(buildEditTransactionPersistenceContext(request(), result)).toEqual({
      transactionId: 'tx-1',
      imageSessionId: 'session-1',
      baseAdjustmentRevision: 4,
      nextAdjustmentRevision: 5,
    });
  });

  test('patches a node-keyed scene-tone document without recreating unrelated nodes', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const result = reduceEditTransaction(
      INITIAL_ADJUSTMENTS,
      4,
      request({
        operations: [
          {
            type: 'patch-edit-document-node',
            nodeType: 'scene_global_color_tone',
            patch: { exposure: 0.75, highlights: -20 },
          },
        ],
      }),
      undefined,
      document,
    );

    expect(result.after).toMatchObject({ exposure: 0.75, highlights: -20 });
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone?.params).toMatchObject({
      exposure: 0.75,
      highlights: -20,
    });
    expect(result.afterEditDocumentV2.nodes.geometry).toBe(document.nodes.geometry);
    expect(result.afterEditDocumentV2.nodes.scene_curve).toBe(document.nodes.scene_curve);
    expect(result.changedKeys).toEqual(['exposure', 'highlights']);
  });

  test('patches strict geometry and its explicit domain without recreating unrelated nodes', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const crop = { height: 1800, unit: 'px' as const, width: 2400, x: 400, y: 300 };
    const result = reduceEditTransaction(
      INITIAL_ADJUSTMENTS,
      4,
      request({
        operations: [{ nodeType: 'geometry', patch: { crop, rotation: 2.5 }, type: 'patch-edit-document-node' }],
        source: 'geometry-tool',
      }),
      undefined,
      document,
    );

    expect(result.after).toMatchObject({ crop, rotation: 2.5 });
    expect(result.afterEditDocumentV2.geometry).toEqual(result.afterEditDocumentV2.nodes.geometry?.params);
    expect(result.afterEditDocumentV2.geometry).toMatchObject({ crop, rotation: 2.5 });
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toBe(document.nodes.scene_global_color_tone);
    expect(result.afterEditDocumentV2.nodes.layers).toBe(document.nodes.layers);
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail', 'geometry']);
  });

  test('focused Light reset preserves newer unmigrated Detail and Effects state', () => {
    const before = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      brightness: 0.42,
      clarity: 18,
      contrast: 12,
      glowAmount: 16,
    };
    const staleDocument = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const afterReset = {
      ...before,
      brightness: INITIAL_ADJUSTMENTS.brightness,
      contrast: INITIAL_ADJUSTMENTS.contrast,
    };
    const result = reduceEditTransaction(
      before,
      4,
      request({ operations: buildAdjustmentMutationOperations(before, afterReset) }),
      undefined,
      staleDocument,
    );

    expect(result.changedKeys).toEqual(['brightness', 'contrast']);
    expect(result.after).toMatchObject({ brightness: 0, clarity: 18, contrast: 0, glowAmount: 16 });
    expect(result.after.masks).toBe(before.masks);
    expect(result.after.levels).toBe(before.levels);
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone?.params).toMatchObject({
      brightness: 0,
      contrast: 0,
    });
  });

  test('atomic hydration publishes mixed domains before a focused Light reset', () => {
    const hydratedAdjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      brightness: 0.42,
      clarity: 18,
      contrast: 12,
      glowAmount: 16,
    };
    useEditorStore.getState().hydrateEditorRenderAuthority({ adjustments: hydratedAdjustments });
    const hydrated = useEditorStore.getState();

    expect(hydrated.adjustmentSnapshot.editDocumentV2).toBe(hydrated.editDocumentV2);
    expect(hydrated.editDocumentV2.nodes.detail_denoise_dehaze?.params.clarity).toBe(18);
    expect(hydrated.adjustmentSnapshot.value.glowAmount).toBe(16);

    const afterReset = { ...hydrated.adjustments, brightness: 0, contrast: 0 };
    hydrated.applyEditTransaction(
      request({
        baseAdjustmentRevision: hydrated.adjustmentRevision,
        imageSessionId: 'editor-image-session:1',
        operations: buildAdjustmentMutationOperations(hydrated.adjustments, afterReset),
      }),
    );
    const reset = useEditorStore.getState();

    expect(reset.adjustments).toMatchObject({ brightness: 0, clarity: 18, contrast: 0, glowAmount: 16 });
    expect(reset.adjustmentSnapshot.editDocumentV2).toBe(reset.editDocumentV2);
  });

  test('rejects fields and values outside scene-tone node ownership', () => {
    const wrongField = request({
      operations: [
        {
          type: 'patch-edit-document-node',
          nodeType: 'scene_global_color_tone',
          patch: { temperature: 20 },
        },
      ],
    });
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 4, wrongField)).toThrow(
      'edit_transaction.field_not_owned:scene_global_color_tone:temperature',
    );

    const outOfRange = request({
      operations: [
        {
          type: 'patch-edit-document-node',
          nodeType: 'scene_global_color_tone',
          patch: { exposure: 6 },
        },
      ],
    });
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 4, outOfRange)).toThrow();
  });

  test('exact no-ops do not advance revision or create a changed-key set', () => {
    const currentDocument = setEditDocumentV2NodeEnabled(
      legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS),
      'scene_curve',
      false,
    );
    const result = reduceEditTransaction(
      INITIAL_ADJUSTMENTS,
      4,
      request({
        operations: [{ type: 'patch-adjustments', patch: { exposure: INITIAL_ADJUSTMENTS.exposure } }],
      }),
      undefined,
      currentDocument,
    );

    expect(result.noOp).toBe(true);
    expect(result.changedKeys).toEqual([]);
    expect(result.nextAdjustmentRevision).toBe(4);
    expect(result.afterEditDocumentV2).toEqual(currentDocument);

    const replacement = reduceEditTransaction(
      INITIAL_ADJUSTMENTS,
      4,
      request({ operations: [{ type: 'replace-adjustments', adjustments: INITIAL_ADJUSTMENTS }] }),
      undefined,
      currentDocument,
    );
    expect(replacement.noOp).toBeTrue();
    expect(replacement.afterEditDocumentV2).toEqual(currentDocument);

    const roundTrip = reduceEditTransaction(
      INITIAL_ADJUSTMENTS,
      4,
      request({
        operations: [
          { type: 'patch-adjustments', patch: { exposure: 0.5 } },
          { type: 'replace-adjustments', adjustments: INITIAL_ADJUSTMENTS },
        ],
      }),
      undefined,
      currentDocument,
    );
    expect(roundTrip.noOp).toBeTrue();
    expect(roundTrip.after).toEqual(INITIAL_ADJUSTMENTS);
    expect(roundTrip.afterEditDocumentV2).toEqual(currentDocument);
  });

  test('rejects stale proposals before applying any operation', () => {
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 5, request())).toThrow('edit_transaction.stale_base:4:5');
  });

  test('rejects proposals from an older image session before reducing operations', () => {
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 4, request(), 'session-2')).toThrow(
      'edit_transaction.stale_session:session-1:session-2',
    );
  });

  test('rejects non-finite numeric values at the transaction boundary', () => {
    expect(() =>
      reduceEditTransaction(
        INITIAL_ADJUSTMENTS,
        4,
        request({ operations: [{ type: 'patch-adjustments', patch: { exposure: Number.NaN } }] }),
      ),
    ).toThrow('edit_transaction.invalid_value:exposure');
  });

  test('store commit publishes one canonical state and one history boundary', () => {
    const result = useEditorStore
      .getState()
      .applyEditTransaction(request({ baseAdjustmentRevision: 0, imageSessionId: 'editor-image-session:1' }));
    const state = useEditorStore.getState();

    expect(result.changedKeys).toEqual(['exposure']);
    expect(state.adjustments.exposure).toBe(0.5);
    expect(state.adjustmentRevision).toBe(1);
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
  });

  test('store publishes the node document in the same immutable render snapshot', () => {
    const result = useEditorStore.getState().applyEditTransaction(
      request({
        baseAdjustmentRevision: 0,
        imageSessionId: 'editor-image-session:1',
        operations: [
          {
            type: 'patch-edit-document-node',
            nodeType: 'scene_global_color_tone',
            patch: { exposure: 1.25 },
          },
        ],
      }),
    );
    const state = useEditorStore.getState();

    expect(result.afterEditDocumentV2).toBe(state.editDocumentV2);
    expect(state.adjustmentSnapshot.editDocumentV2).toBe(state.editDocumentV2);
    expect(state.adjustmentSnapshot.editDocumentV2.nodes.scene_global_color_tone?.params.exposure).toBe(1.25);
    expect(state.adjustmentSnapshot.value.exposure).toBe(1.25);
  });

  test('layer commands publish canonical state and history through the authority', () => {
    const next = {
      ...INITIAL_ADJUSTMENTS,
      masks: [
        {
          adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
          editNodes: createDefaultMaskEditNodes(),
          editNodeSchemaVersion: 1 as const,
          id: 'layer-1',
          invert: false,
          name: 'Layer 1',
          opacity: 100,
          subMasks: [],
          visible: false,
        },
      ],
    };
    const result = useEditorStore.getState().applyEditTransaction(
      request({
        transactionId: 'layer-1',
        baseAdjustmentRevision: 0,
        imageSessionId: 'editor-image-session:1',
        source: 'layer-command',
        operations: [{ type: 'replace-adjustments', adjustments: next }],
      }),
    );
    const state = useEditorStore.getState();

    expect(result.applicationReceipt.source).toBe('layer-command');
    expect(state.adjustments.masks).toEqual(next.masks);
    expect(state.history).toHaveLength(2);
  });

  test('layer command boundary carries session/revision identity into persistence', () => {
    const next = {
      ...INITIAL_ADJUSTMENTS,
      masks: [
        {
          adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
          editNodes: createDefaultMaskEditNodes(),
          editNodeSchemaVersion: 1 as const,
          id: 'layer-persisted',
          invert: false,
          name: 'Layer persisted',
          opacity: 100,
          subMasks: [],
          visible: true,
        },
      ],
    };
    const request = buildLayerEditTransactionRequest(
      {
        adjustmentRevision: 7,
        adjustments: INITIAL_ADJUSTMENTS,
        imageSessionId: 4,
        imageSession: { id: 'session-layer' },
      },
      next,
      'layer-persist-1',
    );
    const result = reduceEditTransaction(INITIAL_ADJUSTMENTS, 7, request, 'session-layer');
    const persistence = buildEditTransactionPersistenceContext(request, result);

    expect(request.operations).toEqual([
      {
        type: 'patch-edit-document-node',
        nodeType: 'layers',
        patch: { masks: next.masks },
      },
    ]);
    expect(request.operations.some((operation) => operation.type === 'replace-adjustments')).toBe(false);
    expect(result.afterEditDocumentV2.layers).toEqual({ masks: next.masks });
    expect(result.afterEditDocumentV2.nodes.layers?.params).toEqual(result.afterEditDocumentV2.layers);

    expect(result.applicationReceipt).toMatchObject({
      transactionId: 'layer-persist-1',
      imageSessionId: 'session-layer',
      baseAdjustmentRevision: 7,
      adjustmentRevision: 8,
    });
    expect(persistence).toEqual({
      transactionId: 'layer-persist-1',
      imageSessionId: 'session-layer',
      baseAdjustmentRevision: 7,
      nextAdjustmentRevision: 8,
    });
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 8, request, 'session-layer')).toThrow(
      'edit_transaction.stale_base:7:8',
    );
    expect(() => reduceEditTransaction(INITIAL_ADJUSTMENTS, 7, request, 'session-other')).toThrow(
      'edit_transaction.stale_session:session-layer:session-other',
    );
  });

  test('reset transactions replace history atomically instead of appending a duplicate boundary', () => {
    const store = useEditorStore.getState();
    store.applyEditTransaction(request({ baseAdjustmentRevision: 0, imageSessionId: 'editor-image-session:1' }));

    const reset = store.applyEditTransaction(
      request({
        baseAdjustmentRevision: 1,
        imageSessionId: 'editor-image-session:1',
        source: 'reset',
        history: 'reset',
        operations: [{ type: 'replace-adjustments', adjustments: INITIAL_ADJUSTMENTS }],
      }),
    );
    const state = useEditorStore.getState();

    expect(reset.source).toBe('reset');
    expect(reset.changedKeys).toEqual(['exposure']);
    expect(state.adjustments).toEqual(INITIAL_ADJUSTMENTS);
    expect(state.adjustmentRevision).toBe(2);
    expect(state.history).toEqual([INITIAL_ADJUSTMENTS]);
    expect(state.historyIndex).toBe(0);
    expect(state.historyCheckpoints).toEqual([]);
    expect(() =>
      useEditorStore.getState().applyEditTransaction(
        request({
          baseAdjustmentRevision: 1,
          imageSessionId: 'editor-image-session:1',
          source: 'reset',
          history: 'reset',
          operations: [{ type: 'replace-adjustments', adjustments: INITIAL_ADJUSTMENTS }],
        }),
      ),
    ).toThrow('edit_transaction.stale_base:1:2');
    expect(() =>
      useEditorStore.getState().applyEditTransaction(
        request({
          baseAdjustmentRevision: 2,
          imageSessionId: 'editor-image-session:other',
          source: 'reset',
          history: 'reset',
          operations: [{ type: 'replace-adjustments', adjustments: INITIAL_ADJUSTMENTS }],
        }),
      ),
    ).toThrow('edit_transaction.stale_session:editor-image-session:other:editor-image-session:1');
  });
});
