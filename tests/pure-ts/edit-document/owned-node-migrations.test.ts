import { describe, expect, test } from 'bun:test';
import type {
  EditDocumentNodeEnvelopeV2,
  EditDocumentNodeTypeV2,
  EditDocumentV2,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import {
  compileEditDocumentNodeV2,
  editDocumentBlackWhiteMixerV2Schema,
  editDocumentChannelMixerV2Schema,
  editDocumentColorBalanceRgbV2Schema,
  editDocumentColorPresenceV2Schema,
  editDocumentFilmEmulationV2Schema,
  editDocumentGeometryV2Schema,
  editDocumentLensCorrectionV2Schema,
  editDocumentLumaLevelsV2Schema,
  editDocumentSelectiveColorMixerV2Schema,
  editDocumentSkinToneUniformityV2Schema,
  editDocumentV2Schema,
  sceneGlobalColorToneParamsV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  editDocumentV2NodeInventory,
  legacyAdjustmentsToEditDocumentV2,
  resetEditDocumentV2Node,
} from '../../../src/utils/editDocumentV2';

const requireNode = (document: EditDocumentV2, nodeType: EditDocumentNodeTypeV2): EditDocumentNodeEnvelopeV2 => {
  const node = document.nodes[nodeType];
  if (node === undefined) throw new Error(`expected ${nodeType} fixture`);
  return node;
};

describe('EditDocumentV2 owned node migrations', () => {
  test('maps adjustment ownership into a stable node inventory', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure: 0.75,
      crop: { unit: '%', x: 1, y: 2, width: 95, height: 90 },
    });

    expect(document.schemaVersion).toBe(2);
    expect(editDocumentV2NodeInventory(document)).toEqual([
      'source_decode',
      'scene_global_color_tone',
      'color_presence',
      'scene_curve',
      'tone_equalizer',
      'display_creative',
      'film_emulation',
      'detail_denoise_dehaze',
      'point_color',
      'color_balance_rgb',
      'selective_color_mixer',
      'skin_tone_uniformity',
      'black_white_mixer',
      'channel_mixer',
      'luma_levels',
      'perceptual_grading',
      'camera_input',
      'lens_correction',
      'color_calibration',
      'geometry',
      'layers',
      'source_artifacts',
    ]);
    expect(
      sceneGlobalColorToneParamsV2Schema.parse(requireNode(document, 'scene_global_color_tone').params).exposure,
    ).toBe(0.75);
    expect(document.geometry.crop).toEqual({ unit: '%', x: 1, y: 2, width: 95, height: 90 });
    expect(document.migration?.mapped).toContain('scene_global_color_tone.exposure');
    expect(document.migration?.quarantined).not.toContain('sectionVisibility');
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('sectionVisibility');
  });

  test('owns strict Film Emulation state and migrates old V2 authority idempotently', () => {
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
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      filmEmulation,
    });
    expect(
      editDocumentFilmEmulationV2Schema.parse(requireNode(document, 'film_emulation').params).filmEmulation,
    ).toEqual(filmEmulation);
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('filmEmulation');
    expect(document.migration?.mapped).toContain('film_emulation.filmEmulation');

    const oldV2 = structuredClone(document);
    delete oldV2.nodes['film_emulation'];
    const legacyExtensions = oldV2.extensions['legacyAdjustments'];
    if (legacyExtensions === null || typeof legacyExtensions !== 'object') {
      throw new Error('expected legacy extensions fixture');
    }
    Reflect.set(legacyExtensions, 'filmEmulation', filmEmulation);
    if (oldV2.migration === undefined) throw new Error('fixture migration receipt is required');
    oldV2.migration.mapped = oldV2.migration.mapped.filter((path) => path !== 'film_emulation.filmEmulation');
    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(
      editDocumentFilmEmulationV2Schema.parse(requireNode(reopened, 'film_emulation').params).filmEmulation,
    ).toEqual(filmEmulation);
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('filmEmulation');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptOldV2 = structuredClone(oldV2);
    const corruptExtensions = corruptOldV2.extensions['legacyAdjustments'];
    if (corruptExtensions === null || typeof corruptExtensions !== 'object') {
      throw new Error('expected corrupt legacy extensions fixture');
    }
    Reflect.set(corruptExtensions, 'filmEmulation', { mix: 1 });
    const quarantined = editDocumentV2Schema.parse(corruptOldV2);
    expect(
      editDocumentFilmEmulationV2Schema.parse(requireNode(quarantined, 'film_emulation').params).filmEmulation,
    ).toBeNull();
    expect(quarantined.extensions['quarantinedLegacyAdjustments']).toEqual({ filmEmulation: { mix: 1 } });
    expect(quarantined.migration?.quarantined).toContain('filmEmulation');

    const corruptFlat = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      filmEmulation: { mix: 1 },
    });
    expect(
      editDocumentFilmEmulationV2Schema.parse(requireNode(corruptFlat, 'film_emulation').params).filmEmulation,
    ).toBeNull();
    expect(corruptFlat.extensions['quarantinedLegacyAdjustments']).toEqual({ filmEmulation: { mix: 1 } });
  });

  test('rejects retired flat Film authority and retired Film nodes', () => {
    expect(() =>
      legacyAdjustmentsToEditDocumentV2({
        ...structuredClone(INITIAL_ADJUSTMENTS),
        filmLookId: 'film_look.generic.warm_print.v1',
        filmLookStrength: 65,
      }),
    ).toThrow("rejects retired pre-node Film field 'filmLookId'");

    const current = legacyAdjustmentsToEditDocumentV2(structuredClone(INITIAL_ADJUSTMENTS));
    const retiredNode = {
      ...structuredClone(current),
      nodes: {
        ...structuredClone(current.nodes),
        film_look: {
          enabled: true,
          implementationVersion: 1,
          params: { filmLookId: 'film_look.generic.warm_print.v1', filmLookStrength: 65 },
          process: 'scene_referred_v2',
          type: 'film_look',
        },
      },
    };
    expect(editDocumentV2Schema.safeParse(retiredNode).success).toBeFalse();
  });

  test('owns strict Color Presence state and migrates old scene-node fields idempotently', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      hue: -38,
      vibrance: 47,
    });
    expect(editDocumentColorPresenceV2Schema.parse(requireNode(document, 'color_presence').params)).toMatchObject({
      hue: -38,
      saturation: 0,
      vibrance: 47,
    });
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('hue');
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('vibrance');
    expect(document.migration?.mapped).toContain('color_presence.hue');
    expect(document.migration?.mapped).toContain('color_presence.vibrance');

    const oldV2 = structuredClone(document);
    const oldSceneNode = requireNode(oldV2, 'scene_global_color_tone');
    oldSceneNode.params = { ...oldSceneNode.params, hue: -38, saturation: 0, vibrance: 47 };
    delete oldV2.nodes['color_presence'];
    if (oldV2.migration === undefined) throw new Error('fixture migration receipt is required');
    oldV2.migration.mapped = oldV2.migration.mapped.filter(
      (path) => path !== 'color_presence.hue' && path !== 'color_presence.vibrance',
    );
    oldV2.migration.quarantined.push('hue', 'vibrance');
    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(editDocumentColorPresenceV2Schema.parse(requireNode(reopened, 'color_presence').params)).toMatchObject({
      hue: -38,
      saturation: 0,
      vibrance: 47,
    });
    expect(requireNode(reopened, 'scene_global_color_tone').params).not.toHaveProperty('saturation');
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('hue');
    expect(reopened.extensions['legacyAdjustments']).not.toHaveProperty('vibrance');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corrupt = structuredClone(oldV2);
    delete corrupt.nodes['color_presence'];
    const corruptSceneNode = requireNode(corrupt, 'scene_global_color_tone');
    corruptSceneNode.params = { ...corruptSceneNode.params, hue: 181 };
    const quarantined = editDocumentV2Schema.parse(corrupt);
    expect(editDocumentColorPresenceV2Schema.parse(requireNode(quarantined, 'color_presence').params).hue).toBe(0);
    expect(quarantined.extensions['quarantinedLegacyAdjustments']).toMatchObject({ hue: 181 });
    expect(quarantined.migration?.defaulted).toContain('color_presence.hue');

    const invalid = structuredClone(INITIAL_ADJUSTMENTS);
    invalid.vibrance = Number.NaN;
    const invalidLegacy = legacyAdjustmentsToEditDocumentV2(invalid);
    expect(editDocumentColorPresenceV2Schema.parse(requireNode(invalidLegacy, 'color_presence').params).vibrance).toBe(
      0,
    );
    const quarantinedLegacy = invalidLegacy.extensions['quarantinedLegacyAdjustments'];
    if (quarantinedLegacy === null || typeof quarantinedLegacy !== 'object') {
      throw new Error('expected quarantined legacy fixture');
    }
    expect(Reflect.get(quarantinedLegacy, 'vibrance')).toBeNaN();
  });

  test('owns strict Perspective Correction state in the geometry node and explicit domain', () => {
    const perspectiveCorrection = {
      ...structuredClone(INITIAL_ADJUSTMENTS.perspectiveCorrection),
      amount: 72,
      guides: [
        {
          class: 'vertical' as const,
          endpointsSourceNormalized: [
            [0.2, 0.1],
            [0.1, 0.9],
          ] as [[number, number], [number, number]],
          id: 'left',
          weight: 1,
        },
      ],
      mode: 'guided' as const,
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      perspectiveCorrection,
    });

    expect(editDocumentGeometryV2Schema.parse(requireNode(document, 'geometry').params).perspectiveCorrection).toEqual(
      perspectiveCorrection,
    );
    expect(document.geometry.perspectiveCorrection).toEqual(perspectiveCorrection);
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('perspectiveCorrection');
    expect(document.migration?.mapped).toContain('geometry.perspectiveCorrection');
    expect(
      editDocumentGeometryV2Schema.parse(compileEditDocumentNodeV2(requireNode(document, 'geometry')).params)
        .perspectiveCorrection,
    ).toEqual(perspectiveCorrection);

    const reset = resetEditDocumentV2Node(document, 'geometry');
    expect(editDocumentGeometryV2Schema.parse(requireNode(reset, 'geometry').params).perspectiveCorrection).toEqual(
      INITIAL_ADJUSTMENTS.perspectiveCorrection,
    );
    expect(reset.geometry.perspectiveCorrection).toEqual(INITIAL_ADJUSTMENTS.perspectiveCorrection);
    expect(reset.extensions['legacyAdjustments']).not.toHaveProperty('perspectiveCorrection');

    const futurePerspective = { ...perspectiveCorrection, futureProjection: true };
    const unknown = {
      ...structuredClone(document),
      geometry: { ...document.geometry, perspectiveCorrection: futurePerspective },
      nodes: {
        ...structuredClone(document.nodes),
        geometry: {
          ...requireNode(document, 'geometry'),
          params: { ...requireNode(document, 'geometry').params, perspectiveCorrection: futurePerspective },
        },
      },
    };
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();
  });

  test('owns strict black-and-white mixer state and excludes it from quarantined legacy fields', () => {
    const blackWhiteMixer = {
      ...structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer),
      enabled: true,
      process: 'continuous_sensitivity_v1' as const,
      weights: { ...INITIAL_ADJUSTMENTS.blackWhiteMixer.weights, oranges: 36 },
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      blackWhiteMixer,
    });

    expect(editDocumentBlackWhiteMixerV2Schema.parse(requireNode(document, 'black_white_mixer').params)).toEqual({
      blackWhiteMixer,
    });
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('blackWhiteMixer');
    expect(document.migration?.mapped).toContain('black_white_mixer.blackWhiteMixer');
    expect(
      editDocumentBlackWhiteMixerV2Schema.parse(
        compileEditDocumentNodeV2(requireNode(document, 'black_white_mixer')).params,
      ),
    ).toEqual({ blackWhiteMixer });

    const unknown = structuredClone(document);
    requireNode(unknown, 'black_white_mixer').params = {
      blackWhiteMixer: { ...blackWhiteMixer, futureResponse: true },
    };
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    requireNode(outOfRange, 'black_white_mixer').params = {
      blackWhiteMixer: {
        ...blackWhiteMixer,
        weights: { ...blackWhiteMixer.weights, reds: 101 },
      },
    };
    expect(() => editDocumentV2Schema.parse(outOfRange)).toThrow();
  });

  test('owns strict channel mixer state and excludes it from quarantined legacy fields', () => {
    const channelMixer = {
      ...structuredClone(INITIAL_ADJUSTMENTS.channelMixer),
      enabled: true,
      red: { ...INITIAL_ADJUSTMENTS.channelMixer.red, green: 24 },
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      channelMixer,
    });

    expect(editDocumentChannelMixerV2Schema.parse(requireNode(document, 'channel_mixer').params)).toEqual({
      channelMixer,
    });
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('channelMixer');
    expect(document.migration?.mapped).toContain('channel_mixer.channelMixer');
    expect(
      editDocumentChannelMixerV2Schema.parse(compileEditDocumentNodeV2(requireNode(document, 'channel_mixer')).params),
    ).toEqual({ channelMixer });

    const unknown = structuredClone(document);
    requireNode(unknown, 'channel_mixer').params = { channelMixer: { ...channelMixer, futureMatrix: true } };
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    requireNode(outOfRange, 'channel_mixer').params = {
      channelMixer: {
        ...channelMixer,
        red: { ...channelMixer.red, green: 201 },
      },
    };
    expect(() => editDocumentV2Schema.parse(outOfRange)).toThrow();
  });

  test('owns strict Color Balance RGB state and excludes it from quarantined legacy fields', () => {
    const colorBalanceRgb = {
      ...structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb),
      enabled: true,
      midtones: { ...INITIAL_ADJUSTMENTS.colorBalanceRgb.midtones, red: 24 },
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      colorBalanceRgb,
    });

    expect(editDocumentColorBalanceRgbV2Schema.parse(requireNode(document, 'color_balance_rgb').params)).toEqual({
      colorBalanceRgb,
    });
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('colorBalanceRgb');
    expect(document.migration?.mapped).toContain('color_balance_rgb.colorBalanceRgb');
    expect(
      editDocumentColorBalanceRgbV2Schema.parse(
        compileEditDocumentNodeV2(requireNode(document, 'color_balance_rgb')).params,
      ),
    ).toEqual({ colorBalanceRgb });

    const unknown = structuredClone(document);
    requireNode(unknown, 'color_balance_rgb').params = {
      colorBalanceRgb: { ...colorBalanceRgb, futureRange: true },
    };
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    requireNode(outOfRange, 'color_balance_rgb').params = {
      colorBalanceRgb: {
        ...colorBalanceRgb,
        highlights: { ...colorBalanceRgb.highlights, blue: 101 },
      },
    };
    expect(() => editDocumentV2Schema.parse(outOfRange)).toThrow();

    const identity = structuredClone(document);
    requireNode(identity, 'color_balance_rgb').params = {
      colorBalanceRgb: {
        ...structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb),
        enabled: true,
      },
    };
    expect(() => editDocumentV2Schema.parse(identity)).toThrow();
  });

  test('owns strict luma Levels state and excludes it from quarantined legacy fields', () => {
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

    expect(editDocumentLumaLevelsV2Schema.parse(requireNode(document, 'luma_levels').params)).toEqual({ levels });
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('levels');
    expect(document.migration?.mapped).toContain('luma_levels.levels');
    expect(
      editDocumentLumaLevelsV2Schema.parse(compileEditDocumentNodeV2(requireNode(document, 'luma_levels')).params),
    ).toEqual({ levels });

    const unknown = structuredClone(document);
    requireNode(unknown, 'luma_levels').params = { levels: { ...levels, futurePivot: true } };
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    requireNode(outOfRange, 'luma_levels').params = { levels: { ...levels, gamma: 5.1 } };
    expect(() => editDocumentV2Schema.parse(outOfRange)).toThrow();

    const invalidRange = structuredClone(document);
    requireNode(invalidRange, 'luma_levels').params = {
      levels: { ...levels, inputBlack: 0.9, inputWhite: 0.9 },
    };
    expect(() => editDocumentV2Schema.parse(invalidRange)).toThrow();
  });

  test('owns strict selective-color HSL and range controls outside legacy extensions', () => {
    const hsl = structuredClone(INITIAL_ADJUSTMENTS.hsl);
    hsl.reds = { hue: 18, luminance: 7, saturation: 31 };
    const selectiveColorRangeControls = structuredClone(INITIAL_ADJUSTMENTS.selectiveColorRangeControls);
    selectiveColorRangeControls.reds = {
      ...selectiveColorRangeControls.reds,
      falloffSmoothness: 2.25,
      widthDegrees: 48,
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      hsl,
      selectiveColorRangeControls,
    });

    expect(
      editDocumentSelectiveColorMixerV2Schema.parse(requireNode(document, 'selective_color_mixer').params),
    ).toEqual({ hsl, selectiveColorRangeControls });
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('hsl');
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('selectiveColorRangeControls');
    expect(document.migration?.mapped).toEqual(
      expect.arrayContaining(['selective_color_mixer.hsl', 'selective_color_mixer.selectiveColorRangeControls']),
    );
    expect(
      editDocumentSelectiveColorMixerV2Schema.parse(
        compileEditDocumentNodeV2(requireNode(document, 'selective_color_mixer')).params,
      ),
    ).toEqual({ hsl, selectiveColorRangeControls });

    const unknown = structuredClone(document);
    requireNode(unknown, 'selective_color_mixer').params = {
      ...requireNode(unknown, 'selective_color_mixer').params,
      futureMixer: true,
    };
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    requireNode(outOfRange, 'selective_color_mixer').params = {
      hsl: {
        ...hsl,
        reds: { ...hsl.reds, saturation: 101 },
      },
      selectiveColorRangeControls,
    };
    expect(() => editDocumentV2Schema.parse(outOfRange)).toThrow();

    const invalidControl = structuredClone(document);
    requireNode(invalidControl, 'selective_color_mixer').params = {
      hsl,
      selectiveColorRangeControls: {
        ...selectiveColorRangeControls,
        reds: { ...selectiveColorRangeControls.reds, centerHueDegrees: 360 },
      },
    };
    expect(() => editDocumentV2Schema.parse(invalidControl)).toThrow();
  });

  test('owns strict skin-tone uniformity state outside legacy extensions', () => {
    const skinToneUniformity = {
      ...structuredClone(INITIAL_ADJUSTMENTS.skinToneUniformity),
      enabled: true,
      hueUniformity: 0.6,
      maxHueShiftDegrees: 12,
      targetHueDegrees: 31,
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      skinToneUniformity,
    });

    expect(editDocumentSkinToneUniformityV2Schema.parse(requireNode(document, 'skin_tone_uniformity').params)).toEqual({
      skinToneUniformity,
    });
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('skinToneUniformity');
    expect(document.migration?.mapped).toContain('skin_tone_uniformity.skinToneUniformity');
    expect(
      editDocumentSkinToneUniformityV2Schema.parse(
        compileEditDocumentNodeV2(requireNode(document, 'skin_tone_uniformity')).params,
      ),
    ).toEqual({ skinToneUniformity });

    const unknown = structuredClone(document);
    requireNode(unknown, 'skin_tone_uniformity').params = {
      ...requireNode(unknown, 'skin_tone_uniformity').params,
      futureUniformity: true,
    };
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    requireNode(outOfRange, 'skin_tone_uniformity').params = {
      skinToneUniformity: { ...skinToneUniformity, targetHueDegrees: 360 },
    };
    expect(() => editDocumentV2Schema.parse(outOfRange)).toThrow();
  });

  test('lens correction owns strict profile identity, coefficients, and integer amounts', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      chromaticAberrationBlueYellow: -18,
      chromaticAberrationRedCyan: 27,
      lensDistortionAmount: 125,
      lensDistortionParams: {
        k1: 0.1,
        k2: 0,
        k3: 0,
        model: 1,
        tca_vb: 0.99,
        tca_vr: 1.01,
        vig_k1: 0.2,
        vig_k2: 0,
        vig_k3: 0,
      },
      lensMaker: 'Fixture Optics',
      lensModel: '35mm Prime',
    });
    expect(editDocumentLensCorrectionV2Schema.parse(requireNode(document, 'lens_correction').params)).toMatchObject({
      chromaticAberrationBlueYellow: -18,
      chromaticAberrationRedCyan: 27,
      lensDistortionAmount: 125,
      lensMaker: 'Fixture Optics',
      lensModel: '35mm Prime',
    });
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('chromaticAberrationBlueYellow');
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('chromaticAberrationRedCyan');
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('lensDistortionAmount');

    for (const [field, value] of [
      ['chromaticAberrationBlueYellow', -101],
      ['chromaticAberrationRedCyan', 101],
      ['lensDistortionAmount', 100.5],
      ['lensTcaAmount', 201],
      ['lensVignetteAmount', -1],
    ] as const) {
      const invalid = structuredClone(document);
      requireNode(invalid, 'lens_correction').params[field] = value;
      expect(() => editDocumentV2Schema.parse(invalid)).toThrow();
    }
    const invalidCoefficient = structuredClone(document);
    const lensParams = editDocumentLensCorrectionV2Schema.parse(requireNode(document, 'lens_correction').params);
    if (lensParams.lensDistortionParams === null) throw new Error('expected lens coefficient fixture');
    requireNode(invalidCoefficient, 'lens_correction').params = {
      ...lensParams,
      lensDistortionParams: { ...lensParams.lensDistortionParams, k1: 10.1 },
    };
    expect(() => editDocumentV2Schema.parse(invalidCoefficient)).toThrow();
  });
});
