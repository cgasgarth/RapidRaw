import { describe, expect, test } from 'bun:test';
import type {
  EditDocumentNodeEnvelopeV2,
  EditDocumentNodeTypeV2,
  EditDocumentV2,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import {
  editDocumentV2Schema,
  getEditDocumentNodeDescriptor,
  parseEditDocumentV2WithQuarantine,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createDefaultMaskEditNodes, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { perceptualGradingFromWheelSurface } from '../../../src/utils/color/perceptualGrading';
import {
  getEditDocumentV2NodeCapabilities,
  legacyAdjustmentsToEditDocumentV2,
  prepareEditDocumentV2ForRender,
  updateEditDocumentV2Node,
} from '../../../src/utils/editDocumentV2';

const requireNode = (document: EditDocumentV2, nodeType: EditDocumentNodeTypeV2): EditDocumentNodeEnvelopeV2 => {
  const node = document.nodes[nodeType];
  if (node === undefined) throw new Error(`expected ${nodeType} fixture`);
  return node;
};

describe('EditDocumentV2 render preparation', () => {
  test('node updates retain unrelated nodes and provenance domains', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const next = editDocumentV2Schema.parse({
      ...document,
      nodes: {
        ...document.nodes,
        scene_global_color_tone: {
          ...requireNode(document, 'scene_global_color_tone'),
          params: { ...requireNode(document, 'scene_global_color_tone').params, exposure: 1 },
        },
      },
      provenance: { referenceMatchApplicationReceipt: null },
    });

    expect(requireNode(next, 'geometry')).toEqual(requireNode(document, 'geometry'));
    expect(next.provenance).toEqual({ referenceMatchApplicationReceipt: null });
    expect(requireNode(next, 'scene_global_color_tone').params['exposure']).toBe(1);
  });

  test('descriptor capabilities and focused updates come from the shared registry', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const next = updateEditDocumentV2Node(document, 'scene_global_color_tone', (params) => ({
      ...params,
      exposure: 0.25,
    }));

    expect(getEditDocumentNodeDescriptor('scene_global_color_tone')?.renderStage).toBe('scene_global_color_tone');
    expect(getEditDocumentV2NodeCapabilities('source_artifacts')).toEqual({
      batch: false,
      copy: false,
      paste: false,
      preset: 'exclude',
      provenance: 'regenerate',
      reset: false,
    });
    expect(requireNode(next, 'geometry')).toBe(requireNode(document, 'geometry'));
    expect(requireNode(next, 'scene_global_color_tone').params['exposure']).toBe(0.25);
  });

  test('render preparation keeps payload residency while overlaying authoritative migrated nodes', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      crop: { height: 1800, unit: 'px', width: 2400, x: 400, y: 300 },
      exposure: 1.25,
    });
    const prepared = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aiPatches: [],
      exposure: -2,
    };
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, [
      'geometry',
      'scene_global_color_tone',
    ]);

    expect(requireNode(renderDocument, 'geometry')).toBe(requireNode(authoritative, 'geometry'));
    expect(renderDocument.geometry).toEqual(authoritative.geometry);
    expect(requireNode(renderDocument, 'scene_global_color_tone')).toBe(
      requireNode(authoritative, 'scene_global_color_tone'),
    );
    expect(requireNode(renderDocument, 'scene_global_color_tone').params['exposure']).toBe(1.25);
    expect(requireNode(renderDocument, 'source_artifacts').params['aiPatches']).toEqual([]);
  });

  test('render preparation overlays the authoritative camera-input envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      cameraProfile: 'camera_neutral',
      whiteBalanceTechnical: {
        ...structuredClone(INITIAL_ADJUSTMENTS.whiteBalanceTechnical),
        mode: 'chromaticity',
        source: 'picker',
      },
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['camera_input']);

    expect(requireNode(renderDocument, 'camera_input')).toBe(requireNode(authoritative, 'camera_input'));
    expect(requireNode(renderDocument, 'camera_input').params).toMatchObject({
      cameraProfile: 'camera_neutral',
      whiteBalanceTechnical: { mode: 'chromaticity', source: 'picker' },
    });
    expect(requireNode(renderDocument, 'geometry')).toEqual(requireNode(preparedDocument, 'geometry'));
    expect(requireNode(renderDocument, 'scene_global_color_tone')).toEqual(
      requireNode(preparedDocument, 'scene_global_color_tone'),
    );
  });

  test('render preparation overlays the authoritative scene-curve envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      curveMode: 'parametric',
      toneCurve: 'shadow_lift',
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['scene_curve']);

    expect(requireNode(renderDocument, 'scene_curve')).toBe(requireNode(authoritative, 'scene_curve'));
    expect(requireNode(renderDocument, 'scene_curve').params).toMatchObject({
      curveMode: 'parametric',
      toneCurve: 'shadow_lift',
    });
    expect(requireNode(renderDocument, 'camera_input')).toEqual(requireNode(preparedDocument, 'camera_input'));
    expect(requireNode(renderDocument, 'geometry')).toEqual(requireNode(preparedDocument, 'geometry'));
  });

  test('render preparation overlays the authoritative detail envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      clarity: 26,
      denoiseShadowBias: -18,
      sharpness: 42,
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['detail_denoise_dehaze']);

    expect(requireNode(renderDocument, 'detail_denoise_dehaze')).toBe(
      requireNode(authoritative, 'detail_denoise_dehaze'),
    );
    expect(requireNode(renderDocument, 'detail_denoise_dehaze').params).toMatchObject({
      clarity: 26,
      denoiseShadowBias: -18,
      sharpness: 42,
    });
    expect(requireNode(renderDocument, 'camera_input')).toEqual(requireNode(preparedDocument, 'camera_input'));
    expect(requireNode(renderDocument, 'scene_curve')).toEqual(requireNode(preparedDocument, 'scene_curve'));
  });

  test('render preparation overlays the authoritative display-creative envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      glowAmount: 12,
      grainAmount: 28,
      vignetteAmount: -32,
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['display_creative']);

    expect(requireNode(renderDocument, 'display_creative')).toBe(requireNode(authoritative, 'display_creative'));
    expect(requireNode(renderDocument, 'display_creative').params).toMatchObject({
      glowAmount: 12,
      grainAmount: 28,
      vignetteAmount: -32,
    });
    expect(requireNode(renderDocument, 'detail_denoise_dehaze')).toEqual(
      requireNode(preparedDocument, 'detail_denoise_dehaze'),
    );
    expect(requireNode(renderDocument, 'scene_curve')).toEqual(requireNode(preparedDocument, 'scene_curve'));
  });

  test('render preparation overlays only current Film Emulation authority', () => {
    const filmEmulation = {
      contractVersion: 1 as const,
      enabled: true,
      mix: 0.65,
      nodeType: 'film_emulation' as const,
      profileRef: {
        contentSha256: `sha256:${'a'.repeat(64)}` as const,
        id: 'rapidraw.reference_film.v1',
        version: '1',
      },
      seedPolicy: 'source_stable_v1' as const,
      workingSpace: 'acescg_linear_v1' as const,
    };
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      filmEmulation,
    });
    const renderDocument = prepareEditDocumentV2ForRender(structuredClone(INITIAL_ADJUSTMENTS), authoritative, [
      'film_emulation',
    ]);

    expect(requireNode(renderDocument, 'film_emulation')).toBe(requireNode(authoritative, 'film_emulation'));
    expect(requireNode(renderDocument, 'film_emulation').params).toEqual({ filmEmulation });
  });

  test('render preparation overlays the authoritative tone-equalizer envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      toneEqualizer: {
        ...structuredClone(INITIAL_ADJUSTMENTS.toneEqualizer),
        bandEv: [0, 0, 0, 0, 0.75, 0, 0, 0, 0],
        enabled: true,
      },
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['tone_equalizer']);

    expect(requireNode(renderDocument, 'tone_equalizer')).toBe(requireNode(authoritative, 'tone_equalizer'));
    expect(requireNode(renderDocument, 'tone_equalizer').params['toneEqualizer']).toMatchObject({
      bandEv: [0, 0, 0, 0, 0.75, 0, 0, 0, 0],
      enabled: true,
    });
    expect(requireNode(renderDocument, 'display_creative')).toEqual(requireNode(preparedDocument, 'display_creative'));
    expect(requireNode(renderDocument, 'scene_curve')).toEqual(requireNode(preparedDocument, 'scene_curve'));
  });

  test('render preparation overlays the authoritative point-color envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      pointColor: { ...structuredClone(INITIAL_ADJUSTMENTS.pointColor), enabled: true, visualizeMode: 'range' },
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['point_color']);

    expect(requireNode(renderDocument, 'point_color')).toBe(requireNode(authoritative, 'point_color'));
    expect(requireNode(renderDocument, 'point_color').params['pointColor']).toMatchObject({
      enabled: true,
      visualizeMode: 'range',
    });
    expect(requireNode(renderDocument, 'display_creative')).toEqual(requireNode(preparedDocument, 'display_creative'));
    expect(requireNode(renderDocument, 'scene_curve')).toEqual(requireNode(preparedDocument, 'scene_curve'));
  });

  test('render preparation overlays the authoritative black-and-white mixer envelope', () => {
    const blackWhiteMixer = {
      ...structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer),
      enabled: true,
      process: 'continuous_sensitivity_v1' as const,
      weights: { ...INITIAL_ADJUSTMENTS.blackWhiteMixer.weights, reds: 32 },
    };
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      blackWhiteMixer,
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['black_white_mixer']);

    expect(requireNode(renderDocument, 'black_white_mixer')).toBe(requireNode(authoritative, 'black_white_mixer'));
    expect(requireNode(renderDocument, 'black_white_mixer').params).toEqual({ blackWhiteMixer });
    expect(requireNode(renderDocument, 'point_color')).toEqual(requireNode(preparedDocument, 'point_color'));
  });

  test('render preparation overlays the authoritative channel mixer envelope', () => {
    const channelMixer = {
      ...structuredClone(INITIAL_ADJUSTMENTS.channelMixer),
      enabled: true,
      red: { ...INITIAL_ADJUSTMENTS.channelMixer.red, green: 24 },
    };
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      channelMixer,
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['channel_mixer']);

    expect(requireNode(renderDocument, 'channel_mixer')).toBe(requireNode(authoritative, 'channel_mixer'));
    expect(requireNode(renderDocument, 'channel_mixer').params).toEqual({ channelMixer });
    expect(requireNode(renderDocument, 'point_color')).toEqual(requireNode(preparedDocument, 'point_color'));
  });

  test('render preparation overlays the authoritative Color Balance RGB envelope', () => {
    const colorBalanceRgb = {
      ...structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb),
      enabled: true,
      midtones: { ...INITIAL_ADJUSTMENTS.colorBalanceRgb.midtones, red: 24 },
    };
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      colorBalanceRgb,
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['color_balance_rgb']);

    expect(requireNode(renderDocument, 'color_balance_rgb')).toBe(requireNode(authoritative, 'color_balance_rgb'));
    expect(requireNode(renderDocument, 'color_balance_rgb').params).toEqual({ colorBalanceRgb });
    expect(requireNode(renderDocument, 'channel_mixer')).toEqual(requireNode(preparedDocument, 'channel_mixer'));
  });

  test('render preparation overlays the authoritative luma Levels envelope', () => {
    const levels = {
      ...structuredClone(INITIAL_ADJUSTMENTS.levels),
      enabled: true,
      gamma: 1.25,
      inputBlack: 0.04,
      inputWhite: 0.96,
    };
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      levels,
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['luma_levels']);

    expect(requireNode(renderDocument, 'luma_levels')).toBe(requireNode(authoritative, 'luma_levels'));
    expect(requireNode(renderDocument, 'luma_levels').params).toEqual({ levels });
    expect(requireNode(renderDocument, 'channel_mixer')).toEqual(requireNode(preparedDocument, 'channel_mixer'));
  });

  test('render preparation overlays the authoritative selective-color envelope', () => {
    const hsl = structuredClone(INITIAL_ADJUSTMENTS.hsl);
    hsl.reds = { hue: 18, luminance: 7, saturation: 31 };
    const selectiveColorRangeControls = structuredClone(INITIAL_ADJUSTMENTS.selectiveColorRangeControls);
    selectiveColorRangeControls.reds.widthDegrees = 48;
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      hsl,
      selectiveColorRangeControls,
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['selective_color_mixer']);

    expect(requireNode(renderDocument, 'selective_color_mixer')).toBe(
      requireNode(authoritative, 'selective_color_mixer'),
    );
    expect(requireNode(renderDocument, 'selective_color_mixer').params).toEqual({ hsl, selectiveColorRangeControls });
    expect(requireNode(renderDocument, 'color_balance_rgb')).toEqual(
      requireNode(preparedDocument, 'color_balance_rgb'),
    );
  });

  test('render preparation overlays the authoritative perceptual-grading envelope', () => {
    const colorGrading = {
      ...structuredClone(INITIAL_ADJUSTMENTS.colorGrading),
      balance: 20,
      midtones: { hue: 35, luminance: 5, saturation: 24 },
    };
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      colorGrading,
      perceptualGradingV1: perceptualGradingFromWheelSurface(colorGrading),
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['perceptual_grading']);

    expect(requireNode(renderDocument, 'perceptual_grading')).toBe(requireNode(authoritative, 'perceptual_grading'));
    expect(requireNode(renderDocument, 'perceptual_grading').params).toMatchObject({
      colorGrading: { balance: 20, midtones: { hue: 35, luminance: 5, saturation: 24 } },
      perceptualGradingV1: { balance: 0.2, perceptualModel: 'oklab_d65_from_acescg_v1' },
    });
    expect(requireNode(renderDocument, 'display_creative')).toEqual(requireNode(preparedDocument, 'display_creative'));
  });

  test('render preparation overlays the authoritative color-calibration envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      colorCalibration: { ...INITIAL_ADJUSTMENTS.colorCalibration, redHue: 18 },
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['color_calibration']);

    expect(requireNode(renderDocument, 'color_calibration')).toBe(requireNode(authoritative, 'color_calibration'));
    expect(requireNode(renderDocument, 'color_calibration').params).toMatchObject({ colorCalibration: { redHue: 18 } });
    expect(requireNode(renderDocument, 'display_creative')).toEqual(requireNode(preparedDocument, 'display_creative'));
  });

  test('render preparation transfers the layers envelope and explicit domain together', () => {
    const layer = {
      adjustments: { saturation: 12 },
      editNodes: createDefaultMaskEditNodes(),
      editNodeSchemaVersion: 1 as const,
      id: 'authoritative-layer',
      invert: false,
      name: 'Authoritative layer',
      opacity: 80,
      subMasks: [],
      visible: true,
    };
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      masks: [layer],
    });
    const prepared = { ...structuredClone(INITIAL_ADJUSTMENTS), masks: [] };
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['layers']);
    expect(requireNode(renderDocument, 'layers')).toBe(requireNode(authoritative, 'layers'));
    expect(renderDocument.layers).toEqual({ masks: [layer] });
    expect(requireNode(renderDocument, 'layers').params).toEqual(renderDocument.layers);
  });

  test('future node types are quarantined and non-finite node values are rejected', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const future = parseEditDocumentV2WithQuarantine({
      ...document,
      nodes: {
        ...document.nodes,
        future_color_v9: { enabled: true, params: { exposure: 2 }, process: 'future_v9', type: 'future_color_v9' },
      },
    });

    expect(future.quarantinedNodeTypes).toEqual(['future_color_v9']);
    expect('future_color_v9' in future.document.nodes).toBe(false);
    expect(future.document.extensions['quarantinedNodes']).toEqual({
      future_color_v9: { enabled: true, params: { exposure: 2 }, process: 'future_v9', type: 'future_color_v9' },
    });
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_global_color_tone: {
            ...requireNode(document, 'scene_global_color_tone'),
            params: { exposure: Number.NaN },
          },
        },
      }),
    ).toThrow('non-finite');
  });
});
