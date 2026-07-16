import { describe, expect, test } from 'bun:test';
import type {
  EditDocumentNodeEnvelopeV2,
  EditDocumentNodeTypeV2,
  EditDocumentV2,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import {
  compileEditDocumentNodeV2,
  editDocumentCameraInputV2Schema,
  editDocumentColorBalanceRgbV2Schema,
  editDocumentDetailDenoiseDehazeV2Schema,
  editDocumentGeometryV2Schema,
  editDocumentLensCorrectionV2Schema,
  editDocumentLumaLevelsV2Schema,
  editDocumentSelectiveColorMixerV2Schema,
  editDocumentV2Schema,
  sceneGlobalColorToneParamsV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const requireNode = (document: EditDocumentV2, nodeType: EditDocumentNodeTypeV2): EditDocumentNodeEnvelopeV2 => {
  const node = document.nodes[nodeType];
  if (node === undefined) throw new Error(`expected ${nodeType} fixture`);
  return node;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const requireExtensionRecord = (document: EditDocumentV2, key: string): Record<string, unknown> => {
  const value = document.extensions[key];
  if (!isRecord(value)) throw new Error(`expected ${key} extension fixture`);
  return value;
};

describe('EditDocumentV2 camera and detail migrations', () => {
  test('scene global tone params are strict, finite, and bounded', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const node = requireNode(document, 'scene_global_color_tone');
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_global_color_tone: { ...node, params: { ...node.params, exposure: 6 } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_global_color_tone: { ...node, params: { ...node.params, futureTone: 1 } },
        },
      }),
    ).toThrow();
  });

  test('camera input defaults current technical state and rejects obsolete or malformed render authority', () => {
    const {
      cameraProfileAmount: _cameraProfileAmount,
      whiteBalanceTechnical: _whiteBalanceTechnical,
      ...legacyCameraInput
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyCameraInput);
    expect(editDocumentCameraInputV2Schema.parse(requireNode(defaulted, 'camera_input').params)).toMatchObject({
      cameraProfile: 'camera_standard',
      cameraProfileAmount: 100,
      whiteBalanceTechnical: { contract: 'rapidraw.white_balance.v1', mode: 'as_shot', source: 'as_shot' },
    });
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining(['camera_input.cameraProfileAmount', 'camera_input.whiteBalanceTechnical']),
    );

    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const cameraNode = requireNode(document, 'camera_input');
    expect(editDocumentCameraInputV2Schema.parse(compileEditDocumentNodeV2(cameraNode).params)).toEqual(
      editDocumentCameraInputV2Schema.parse(cameraNode.params),
    );
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          camera_input: { ...cameraNode, params: { ...cameraNode.params, whiteBalanceMigration: 'native_v1' } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          camera_input: { ...cameraNode, params: { ...cameraNode.params, cameraProfileAmount: 101 } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          camera_input: {
            ...cameraNode,
            params: {
              ...cameraNode.params,
              whiteBalanceTechnical: { ...INITIAL_ADJUSTMENTS.whiteBalanceTechnical, kelvin: 1200 },
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          camera_input: { ...cameraNode, params: { ...cameraNode.params, futureInput: 1 } },
        },
      }),
    ).toThrow();
  });

  test('detail defaults legacy state and rejects malformed render authority', () => {
    const {
      clarity: _clarity,
      colorNoiseReduction: _colorNoiseReduction,
      deblurEnabled: _deblurEnabled,
      deblurSigmaPx: _deblurSigmaPx,
      deblurStrength: _deblurStrength,
      dehaze: _dehaze,
      denoiseContrastProtection: _denoiseContrastProtection,
      denoiseDetail: _denoiseDetail,
      denoiseNaturalGrain: _denoiseNaturalGrain,
      denoiseShadowBias: _denoiseShadowBias,
      centré: _centré,
      localContrastHaloGuard: _localContrastHaloGuard,
      localContrastMidtoneMask: _localContrastMidtoneMask,
      localContrastRadiusPx: _localContrastRadiusPx,
      lumaNoiseReduction: _lumaNoiseReduction,
      sharpnessThreshold: _sharpnessThreshold,
      structure: _structure,
      ...legacyDetail
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2({ ...legacyDetail, sharpness: 24 });
    expect(
      editDocumentDetailDenoiseDehazeV2Schema.parse(requireNode(defaulted, 'detail_denoise_dehaze').params),
    ).toEqual({
      centré: 0,
      clarity: 0,
      colorNoiseReduction: 0,
      deblurEnabled: false,
      deblurSigmaPx: 0.8,
      deblurStrength: 0,
      dehaze: 0,
      denoiseContrastProtection: 50,
      denoiseDetail: 50,
      denoiseNaturalGrain: 0,
      denoiseShadowBias: 0,
      localContrastHaloGuard: 50,
      localContrastMidtoneMask: 50,
      localContrastRadiusPx: 24,
      lumaNoiseReduction: 0,
      sharpness: 24,
      sharpnessThreshold: 15,
      structure: 0,
    });
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining([
        'detail_denoise_dehaze.clarity',
        'detail_denoise_dehaze.deblurEnabled',
        'detail_denoise_dehaze.deblurSigmaPx',
        'detail_denoise_dehaze.deblurStrength',
        'detail_denoise_dehaze.denoiseContrastProtection',
        'detail_denoise_dehaze.denoiseDetail',
        'detail_denoise_dehaze.localContrastRadiusPx',
        'detail_denoise_dehaze.sharpnessThreshold',
        'detail_denoise_dehaze.structure',
      ]),
    );
    expect(
      editDocumentDetailDenoiseDehazeV2Schema.parse(
        compileEditDocumentNodeV2(requireNode(defaulted, 'detail_denoise_dehaze')).params,
      ).sharpness,
    ).toBe(24);

    const detailNode = requireNode(defaulted, 'detail_denoise_dehaze');
    const {
      deblurEnabled: _enabled,
      deblurSigmaPx: _sigma,
      deblurStrength: _strength,
      ...preDeblurParams
    } = editDocumentDetailDenoiseDehazeV2Schema.parse(detailNode.params);
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          detail_denoise_dehaze: { ...detailNode, params: preDeblurParams },
        },
      }),
    ).not.toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          detail_denoise_dehaze: { ...detailNode, params: { ...detailNode.params, futureDetail: true } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          detail_denoise_dehaze: {
            ...detailNode,
            params: { ...detailNode.params, lumaNoiseReduction: -1 },
          },
        },
      }),
    ).toThrow();
    for (const patch of [
      { deblurSigmaPx: 0.44 },
      { deblurSigmaPx: 1.36 },
      { deblurStrength: 101 },
      { deblurStrength: 32.5 },
      { deblurEnabled: 1 },
      { centré: -101 },
      { localContrastHaloGuard: 101 },
      { localContrastMidtoneMask: -1 },
      { localContrastRadiusPx: 3.9 },
      { localContrastRadiusPx: 96.1 },
      { sharpnessThreshold: -1 },
      { sharpnessThreshold: 81 },
      { structure: 101 },
    ]) {
      expect(() =>
        editDocumentV2Schema.parse({
          ...defaulted,
          nodes: {
            ...defaulted.nodes,
            detail_denoise_dehaze: { ...detailNode, params: { ...detailNode.params, ...patch } },
          },
        }),
      ).toThrow();
    }
  });

  test('promotes pre-threshold V2 state and quarantines corrupt values idempotently', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      sharpnessThreshold: 33,
    });
    const oldV2 = structuredClone(document);
    const detailNode = requireNode(oldV2, 'detail_denoise_dehaze');
    const detailParams = detailNode.params;
    const legacyAdjustments = requireExtensionRecord(oldV2, 'legacyAdjustments');
    const migration = oldV2.migration;
    if (migration === undefined) throw new Error('fixture migration receipt is required');
    legacyAdjustments['sharpnessThreshold'] = detailParams['sharpnessThreshold'];
    delete detailParams['sharpnessThreshold'];
    migration.mapped = migration.mapped.filter((path) => path !== 'detail_denoise_dehaze.sharpnessThreshold');
    migration.quarantined.push('sharpnessThreshold');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(
      editDocumentDetailDenoiseDehazeV2Schema.parse(requireNode(reopened, 'detail_denoise_dehaze').params)
        .sharpnessThreshold,
    ).toBe(33);
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('sharpnessThreshold');
    expect(reopened.migration?.mapped).toContain('detail_denoise_dehaze.sharpnessThreshold');
    expect(reopened.migration?.quarantined).not.toContain('sharpnessThreshold');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptOldV2 = structuredClone(oldV2);
    requireExtensionRecord(corruptOldV2, 'legacyAdjustments')['sharpnessThreshold'] = 81;
    const quarantined = editDocumentV2Schema.parse(corruptOldV2);
    expect(
      editDocumentDetailDenoiseDehazeV2Schema.parse(requireNode(quarantined, 'detail_denoise_dehaze').params)
        .sharpnessThreshold,
    ).toBe(15);
    expect(quarantined.extensions['quarantinedLegacyAdjustments']).toEqual({ sharpnessThreshold: 81 });
    expect(quarantined.migration?.defaulted).toContain('detail_denoise_dehaze.sharpnessThreshold');
    expect(quarantined.migration?.quarantined).toContain('sharpnessThreshold');

    const corruptFlat = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      sharpnessThreshold: Number.NaN,
    });
    expect(
      editDocumentDetailDenoiseDehazeV2Schema.parse(requireNode(corruptFlat, 'detail_denoise_dehaze').params)
        .sharpnessThreshold,
    ).toBe(15);
    expect(corruptFlat.extensions['quarantinedLegacyAdjustments']).toEqual({ sharpnessThreshold: Number.NaN });
  });

  test('promotes pre-local-contrast V2 state and quarantines corrupt legacy values idempotently', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      centré: -12,
      localContrastHaloGuard: 64,
      localContrastMidtoneMask: 37,
      localContrastRadiusPx: 42,
      structure: 28,
    });
    const oldV2 = structuredClone(document);
    const detailParams = requireNode(oldV2, 'detail_denoise_dehaze').params;
    const legacyAdjustments = requireExtensionRecord(oldV2, 'legacyAdjustments');
    const migration = oldV2.migration;
    if (migration === undefined) throw new Error('fixture migration receipt is required');
    for (const field of [
      'centré',
      'localContrastHaloGuard',
      'localContrastMidtoneMask',
      'localContrastRadiusPx',
      'structure',
    ] as const) {
      legacyAdjustments[field] = detailParams[field];
      delete detailParams[field];
      migration.mapped = migration.mapped.filter((path) => path !== `detail_denoise_dehaze.${field}`);
      migration.quarantined.push(field);
    }
    legacyAdjustments['localContrastRadiusPx'] = 400;

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(
      editDocumentDetailDenoiseDehazeV2Schema.parse(requireNode(reopened, 'detail_denoise_dehaze').params),
    ).toMatchObject({
      centré: -12,
      localContrastHaloGuard: 64,
      localContrastMidtoneMask: 37,
      localContrastRadiusPx: 24,
      structure: 28,
    });
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('structure');
    expect(reopened.extensions['quarantinedLegacyAdjustments']).toEqual({ localContrastRadiusPx: 400 });
    expect(reopened.migration?.mapped).toContain('detail_denoise_dehaze.structure');
    expect(reopened.migration?.defaulted).toContain('detail_denoise_dehaze.localContrastRadiusPx');
    expect(reopened.migration?.quarantined).toContain('localContrastRadiusPx');
    expect(reopened.migration?.quarantined).not.toContain('structure');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptFlat = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      localContrastRadiusPx: Number.NaN,
    });
    expect(
      editDocumentDetailDenoiseDehazeV2Schema.parse(requireNode(corruptFlat, 'detail_denoise_dehaze').params)
        .localContrastRadiusPx,
    ).toBe(24);
    expect(corruptFlat.extensions['quarantinedLegacyAdjustments']).toEqual({ localContrastRadiusPx: Number.NaN });
    expect(corruptFlat.migration?.defaulted).toContain('detail_denoise_dehaze.localContrastRadiusPx');
    expect(corruptFlat.migration?.mapped).not.toContain('detail_denoise_dehaze.localContrastRadiusPx');
  });

  test('promotes pre-manual-CA V2 state and quarantines corrupt legacy values idempotently', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      chromaticAberrationBlueYellow: -22,
      chromaticAberrationRedCyan: 17,
    });
    const oldV2 = structuredClone(document);
    const lensParams = requireNode(oldV2, 'lens_correction').params;
    const legacyAdjustments = requireExtensionRecord(oldV2, 'legacyAdjustments');
    const migration = oldV2.migration;
    if (migration === undefined) throw new Error('fixture migration receipt is required');
    for (const field of ['chromaticAberrationBlueYellow', 'chromaticAberrationRedCyan'] as const) {
      legacyAdjustments[field] = lensParams[field];
      delete lensParams[field];
      migration.mapped = migration.mapped.filter((path) => path !== `lens_correction.${field}`);
      migration.quarantined.push(field);
    }
    legacyAdjustments['chromaticAberrationRedCyan'] = 500;

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(editDocumentLensCorrectionV2Schema.parse(requireNode(reopened, 'lens_correction').params)).toMatchObject({
      chromaticAberrationBlueYellow: -22,
      chromaticAberrationRedCyan: 0,
    });
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('chromaticAberrationBlueYellow');
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('chromaticAberrationRedCyan');
    expect(reopened.extensions['quarantinedLegacyAdjustments']).toEqual({ chromaticAberrationRedCyan: 500 });
    expect(reopened.migration?.mapped).toContain('lens_correction.chromaticAberrationBlueYellow');
    expect(reopened.migration?.defaulted).toContain('lens_correction.chromaticAberrationRedCyan');
    expect(reopened.migration?.quarantined).toContain('chromaticAberrationRedCyan');
    expect(reopened.migration?.quarantined).not.toContain('chromaticAberrationBlueYellow');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptFlat = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      chromaticAberrationBlueYellow: Number.NaN,
    });
    expect(
      editDocumentLensCorrectionV2Schema.parse(requireNode(corruptFlat, 'lens_correction').params)
        .chromaticAberrationBlueYellow,
    ).toBe(0);
    expect(corruptFlat.extensions['quarantinedLegacyAdjustments']).toEqual({
      chromaticAberrationBlueYellow: Number.NaN,
    });
    expect(corruptFlat.migration?.defaulted).toContain('lens_correction.chromaticAberrationBlueYellow');
    expect(corruptFlat.migration?.mapped).not.toContain('lens_correction.chromaticAberrationBlueYellow');
  });

  test('promotes pre-Perspective geometry state and quarantines corrupt legacy values idempotently', () => {
    const perspectiveCorrection = {
      ...structuredClone(INITIAL_ADJUSTMENTS.perspectiveCorrection),
      amount: 65,
      mode: 'auto_full' as const,
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      perspectiveCorrection,
    });
    const oldV2 = structuredClone(document);
    const oldNodeParams = requireNode(oldV2, 'geometry').params;
    requireExtensionRecord(oldV2, 'legacyAdjustments')['perspectiveCorrection'] = perspectiveCorrection;
    delete oldNodeParams['perspectiveCorrection'];
    Reflect.deleteProperty(oldV2.geometry, 'perspectiveCorrection');
    if (oldV2.migration === undefined) throw new Error('fixture migration receipt is required');
    oldV2.migration.mapped = oldV2.migration.mapped.filter((path) => path !== 'geometry.perspectiveCorrection');
    oldV2.migration.quarantined.push('perspectiveCorrection');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(editDocumentGeometryV2Schema.parse(requireNode(reopened, 'geometry').params).perspectiveCorrection).toEqual(
      perspectiveCorrection,
    );
    expect(reopened.geometry.perspectiveCorrection).toEqual(perspectiveCorrection);
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('perspectiveCorrection');
    expect(reopened.migration?.mapped).toContain('geometry.perspectiveCorrection');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptV2 = structuredClone(document);
    const corrupt = { ...perspectiveCorrection, amount: 500 };
    requireExtensionRecord(corruptV2, 'legacyAdjustments')['perspectiveCorrection'] = corrupt;
    delete requireNode(corruptV2, 'geometry').params['perspectiveCorrection'];
    Reflect.deleteProperty(corruptV2.geometry, 'perspectiveCorrection');
    if (corruptV2.migration === undefined) throw new Error('fixture migration receipt is required');
    corruptV2.migration.mapped = corruptV2.migration.mapped.filter((path) => path !== 'geometry.perspectiveCorrection');
    corruptV2.migration.quarantined.push('perspectiveCorrection');
    const quarantined = editDocumentV2Schema.parse(corruptV2);
    expect(
      editDocumentGeometryV2Schema.parse(requireNode(quarantined, 'geometry').params).perspectiveCorrection,
    ).toEqual(INITIAL_ADJUSTMENTS.perspectiveCorrection);
    expect(quarantined.geometry.perspectiveCorrection).toEqual(INITIAL_ADJUSTMENTS.perspectiveCorrection);
    expect(quarantined.extensions['quarantinedLegacyAdjustments']).toEqual({ perspectiveCorrection: corrupt });
    expect(quarantined.migration?.defaulted).toContain('geometry.perspectiveCorrection');
    expect(quarantined.migration?.quarantined).toContain('perspectiveCorrection');
    expect(editDocumentV2Schema.parse(quarantined)).toEqual(quarantined);

    const corruptFlatAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    corruptFlatAdjustments.perspectiveCorrection.amount = Number.NaN;
    const corruptFlat = legacyAdjustmentsToEditDocumentV2(corruptFlatAdjustments);
    expect(
      editDocumentGeometryV2Schema.parse(requireNode(corruptFlat, 'geometry').params).perspectiveCorrection,
    ).toEqual(INITIAL_ADJUSTMENTS.perspectiveCorrection);
    expect(corruptFlat.extensions['quarantinedLegacyAdjustments']).toEqual({
      perspectiveCorrection: corruptFlatAdjustments.perspectiveCorrection,
    });
    expect(corruptFlat.migration?.mapped).not.toContain('geometry.perspectiveCorrection');
  });

  test('promotes pre-Color-Balance node state and quarantines corrupt legacy values idempotently', () => {
    const colorBalanceRgb = {
      ...structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb),
      enabled: true,
      midtones: { ...INITIAL_ADJUSTMENTS.colorBalanceRgb.midtones, red: 18 },
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      colorBalanceRgb,
    });
    const oldV2 = structuredClone(document);
    const migration = oldV2.migration;
    if (migration === undefined) throw new Error('fixture migration receipt is required');
    requireExtensionRecord(oldV2, 'legacyAdjustments')['colorBalanceRgb'] = colorBalanceRgb;
    delete oldV2.nodes['color_balance_rgb'];
    migration.mapped = migration.mapped.filter((path) => path !== 'color_balance_rgb.colorBalanceRgb');
    migration.quarantined.push('colorBalanceRgb');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(editDocumentColorBalanceRgbV2Schema.parse(requireNode(reopened, 'color_balance_rgb').params)).toEqual({
      colorBalanceRgb,
    });
    expect(requireNode(reopened, 'color_balance_rgb').enabled).toBe(requireNode(reopened, 'channel_mixer').enabled);
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('colorBalanceRgb');
    expect(reopened.migration?.mapped).toContain('color_balance_rgb.colorBalanceRgb');
    expect(reopened.migration?.quarantined).not.toContain('colorBalanceRgb');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptV2 = structuredClone(document);
    const corrupt = {
      ...colorBalanceRgb,
      midtones: { ...colorBalanceRgb.midtones, green: 500 },
    };
    requireExtensionRecord(corruptV2, 'legacyAdjustments')['colorBalanceRgb'] = corrupt;
    delete corruptV2.nodes['color_balance_rgb'];
    const quarantined = editDocumentV2Schema.parse(corruptV2);
    expect(
      editDocumentColorBalanceRgbV2Schema.parse(requireNode(quarantined, 'color_balance_rgb').params).colorBalanceRgb,
    ).toEqual(INITIAL_ADJUSTMENTS.colorBalanceRgb);
    expect(quarantined.extensions['quarantinedLegacyAdjustments']).toEqual({ colorBalanceRgb: corrupt });
    expect(quarantined.migration?.defaulted).toContain('color_balance_rgb.colorBalanceRgb');
    expect(quarantined.migration?.quarantined).toContain('colorBalanceRgb');
    expect(editDocumentV2Schema.parse(quarantined)).toEqual(quarantined);

    const corruptFlatAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    corruptFlatAdjustments.colorBalanceRgb.midtones.green = Number.NaN;
    const corruptFlat = legacyAdjustmentsToEditDocumentV2(corruptFlatAdjustments);
    expect(
      editDocumentColorBalanceRgbV2Schema.parse(requireNode(corruptFlat, 'color_balance_rgb').params).colorBalanceRgb,
    ).toEqual(INITIAL_ADJUSTMENTS.colorBalanceRgb);
    expect(corruptFlat.extensions['quarantinedLegacyAdjustments']).toEqual({
      colorBalanceRgb: corruptFlatAdjustments.colorBalanceRgb,
    });
    expect(corruptFlat.migration?.mapped).not.toContain('color_balance_rgb.colorBalanceRgb');
  });

  test('promotes pre-Levels-node state and quarantines corrupt legacy values idempotently', () => {
    const levels = {
      ...structuredClone(INITIAL_ADJUSTMENTS.levels),
      enabled: true,
      gamma: 1.25,
      inputBlack: 0.04,
      inputWhite: 0.96,
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      levels,
    });
    const oldV2 = structuredClone(document);
    const migration = oldV2.migration;
    if (migration === undefined) throw new Error('fixture migration receipt is required');
    requireExtensionRecord(oldV2, 'legacyAdjustments')['levels'] = levels;
    delete oldV2.nodes['luma_levels'];
    migration.mapped = migration.mapped.filter((path) => path !== 'luma_levels.levels');
    migration.quarantined.push('levels');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(editDocumentLumaLevelsV2Schema.parse(requireNode(reopened, 'luma_levels').params)).toEqual({ levels });
    expect(requireNode(reopened, 'luma_levels').enabled).toBe(requireNode(reopened, 'channel_mixer').enabled);
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('levels');
    expect(reopened.migration?.mapped).toContain('luma_levels.levels');
    expect(reopened.migration?.quarantined).not.toContain('levels');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptV2 = structuredClone(document);
    const corrupt = { ...levels, gamma: 8 };
    requireExtensionRecord(corruptV2, 'legacyAdjustments')['levels'] = corrupt;
    delete corruptV2.nodes['luma_levels'];
    const quarantined = editDocumentV2Schema.parse(corruptV2);
    expect(editDocumentLumaLevelsV2Schema.parse(requireNode(quarantined, 'luma_levels').params).levels).toEqual(
      INITIAL_ADJUSTMENTS.levels,
    );
    expect(quarantined.extensions['quarantinedLegacyAdjustments']).toEqual({ levels: corrupt });
    expect(quarantined.migration?.defaulted).toContain('luma_levels.levels');
    expect(quarantined.migration?.quarantined).toContain('levels');
    expect(editDocumentV2Schema.parse(quarantined)).toEqual(quarantined);

    const corruptFlatAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    corruptFlatAdjustments.levels.gamma = Number.NaN;
    const corruptFlat = legacyAdjustmentsToEditDocumentV2(corruptFlatAdjustments);
    expect(editDocumentLumaLevelsV2Schema.parse(requireNode(corruptFlat, 'luma_levels').params).levels).toEqual(
      INITIAL_ADJUSTMENTS.levels,
    );
    expect(corruptFlat.extensions['quarantinedLegacyAdjustments']).toEqual({
      levels: corruptFlatAdjustments.levels,
    });
    expect(corruptFlat.migration?.mapped).not.toContain('luma_levels.levels');
  });

  test('promotes pre-selective-color node state and quarantines corrupt legacy values idempotently', () => {
    const hsl = structuredClone(INITIAL_ADJUSTMENTS.hsl);
    hsl.oranges = { hue: -11, luminance: 6, saturation: 27 };
    const selectiveColorRangeControls = structuredClone(INITIAL_ADJUSTMENTS.selectiveColorRangeControls);
    selectiveColorRangeControls.oranges.widthDegrees = 54;
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      hsl,
      selectiveColorRangeControls,
    });
    const oldV2 = structuredClone(document);
    const migration = oldV2.migration;
    if (migration === undefined) throw new Error('fixture migration receipt is required');
    const legacyExtensions = requireExtensionRecord(oldV2, 'legacyAdjustments');
    legacyExtensions['hsl'] = hsl;
    legacyExtensions['selectiveColorRangeControls'] = selectiveColorRangeControls;
    delete oldV2.nodes['selective_color_mixer'];
    migration.mapped = migration.mapped.filter((path) => !path.startsWith('selective_color_mixer.'));
    migration.quarantined.push('hsl', 'selectiveColorRangeControls');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(
      editDocumentSelectiveColorMixerV2Schema.parse(requireNode(reopened, 'selective_color_mixer').params),
    ).toEqual({ hsl, selectiveColorRangeControls });
    expect(requireNode(reopened, 'selective_color_mixer').enabled).toBe(requireNode(reopened, 'channel_mixer').enabled);
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('hsl');
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('selectiveColorRangeControls');
    expect(reopened.migration?.mapped).toEqual(
      expect.arrayContaining(['selective_color_mixer.hsl', 'selective_color_mixer.selectiveColorRangeControls']),
    );
    expect(reopened.migration?.quarantined).not.toContain('hsl');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptV2 = structuredClone(document);
    const corruptHsl = structuredClone(hsl);
    corruptHsl.reds.saturation = 500;
    const corruptExtensions = requireExtensionRecord(corruptV2, 'legacyAdjustments');
    corruptExtensions['hsl'] = corruptHsl;
    corruptExtensions['selectiveColorRangeControls'] = selectiveColorRangeControls;
    delete corruptV2.nodes['selective_color_mixer'];
    const quarantined = editDocumentV2Schema.parse(corruptV2);
    const quarantinedParams = editDocumentSelectiveColorMixerV2Schema.parse(
      requireNode(quarantined, 'selective_color_mixer').params,
    );
    expect(quarantinedParams.hsl).toEqual(INITIAL_ADJUSTMENTS.hsl);
    expect(quarantinedParams.selectiveColorRangeControls).toEqual(selectiveColorRangeControls);
    expect(quarantined.extensions['quarantinedLegacyAdjustments']).toEqual({ hsl: corruptHsl });
    expect(quarantined.migration?.defaulted).toContain('selective_color_mixer.hsl');
    expect(quarantined.migration?.quarantined).toContain('hsl');
    expect(editDocumentV2Schema.parse(quarantined)).toEqual(quarantined);

    const corruptFlatAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    corruptFlatAdjustments.selectiveColorRangeControls.blues.widthDegrees = Number.NaN;
    const corruptFlat = legacyAdjustmentsToEditDocumentV2(corruptFlatAdjustments);
    expect(
      editDocumentSelectiveColorMixerV2Schema.parse(requireNode(corruptFlat, 'selective_color_mixer').params)
        .selectiveColorRangeControls,
    ).toEqual(INITIAL_ADJUSTMENTS.selectiveColorRangeControls);
    expect(corruptFlat.extensions['quarantinedLegacyAdjustments']).toEqual({
      selectiveColorRangeControls: corruptFlatAdjustments.selectiveColorRangeControls,
    });
    expect(corruptFlat.migration?.mapped).not.toContain('selective_color_mixer.selectiveColorRangeControls');
  });
});
