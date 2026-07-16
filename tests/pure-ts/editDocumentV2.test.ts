import { describe, expect, test } from 'bun:test';
import {
  compileEditDocumentNodeV2,
  compileEditDocumentV2,
  editDocumentV2Schema,
  getEditDocumentNodeDescriptor,
  parseEditDocumentV2WithQuarantine,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import { matchLookApplicationReceiptV1Schema } from '../../packages/rawengine-schema/src/referenceMatchRuntime';
import { createDefaultMaskEditNodes, INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import { perceptualGradingFromWheelSurface } from '../../src/utils/color/perceptualGrading';
import {
  batchUpdateEditDocumentV2Nodes,
  buildEditDocumentV2Diagnostics,
  copyEditDocumentV2Node,
  copyEditDocumentV2Nodes,
  EDIT_DOCUMENT_V2_COPYABLE_LEGACY_FIELDS,
  editDocumentV2NodeInventory,
  editDocumentV2ToLegacyAdjustments,
  getEditDocumentV2NodeCapabilities,
  legacyAdjustmentsToEditDocumentV2,
  lowerEditDocumentV2CopyPayloadToLegacyAdjustments,
  pasteEditDocumentV2Node,
  prepareEditDocumentV2ForRender,
  replaceEditDocumentV2SourceArtifacts,
  resetEditDocumentV2Node,
  selectEditDocumentV2CopyPayload,
  setEditDocumentV2NodeEnabled,
  updateEditDocumentV2Node,
} from '../../src/utils/editDocumentV2';

const referenceMatchReceipt = matchLookApplicationReceiptV1Schema.parse({
  appliedDiffs: [{ after: 0.75, before: 0, key: 'exposure' }],
  appliedAt: '2026-07-14T20:00:00.000Z',
  baseGraphFingerprint: `fnv1a64:${'0'.repeat(16)}`,
  destination: 'global-adjustments',
  effectiveReferences: [{ role: 'creative', sourceFingerprint: `fnv1a64:${'4'.repeat(16)}`, weight: 1 }],
  enabledGroups: ['tone'],
  historyEntriesAdded: 1,
  impact: 75,
  proposalFingerprint: `fnv1a64:${'1'.repeat(16)}`,
  resultingGraphFingerprint: `fnv1a64:${'2'.repeat(16)}`,
  schemaVersion: 1,
  targetAnalysisFingerprint: `fnv1a64:${'3'.repeat(16)}`,
});

const sourcePatch = {
  id: 'patch-1',
  invert: false,
  isLoading: false,
  name: 'Repair',
  patchData: { pixels: 'resident-payload' },
  prompt: 'remove distraction',
  subMasks: [
    {
      id: 'mask-1',
      invert: false,
      mode: 'additive' as const,
      opacity: 80,
      parameters: { mask_data_base64: 'encoded-mask' },
      type: 'brush' as const,
      visible: true,
    },
  ],
  visible: true,
};

describe('EditDocumentV2 legacy adapter', () => {
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
      'film_look',
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
    expect(document.nodes.scene_global_color_tone?.params.exposure).toBe(0.75);
    expect(document.geometry.crop).toEqual({ unit: '%', x: 1, y: 2, width: 95, height: 90 });
    expect(document.migration?.mapped).toContain('scene_global_color_tone.exposure');
    expect(document.migration?.quarantined).not.toContain('sectionVisibility');
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('sectionVisibility');
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
    expect(document.nodes.film_emulation.params.filmEmulation).toEqual(filmEmulation);
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('filmEmulation');
    expect(document.migration?.mapped).toContain('film_emulation.filmEmulation');

    const oldV2 = structuredClone(document);
    delete (oldV2.nodes as Partial<typeof oldV2.nodes>).film_emulation;
    (oldV2.extensions.legacyAdjustments as Record<string, unknown>).filmEmulation = filmEmulation;
    if (oldV2.migration === undefined) throw new Error('fixture migration receipt is required');
    oldV2.migration.mapped = oldV2.migration.mapped.filter((path) => path !== 'film_emulation.filmEmulation');
    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.film_emulation.params.filmEmulation).toEqual(filmEmulation);
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('filmEmulation');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptOldV2 = structuredClone(oldV2);
    (corruptOldV2.extensions.legacyAdjustments as Record<string, unknown>).filmEmulation = { mix: 1 };
    const quarantined = editDocumentV2Schema.parse(corruptOldV2);
    expect(quarantined.nodes.film_emulation.params.filmEmulation).toBeNull();
    expect(quarantined.extensions.quarantinedLegacyAdjustments).toEqual({ filmEmulation: { mix: 1 } });
    expect(quarantined.migration?.quarantined).toContain('filmEmulation');

    const corruptFlat = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      filmEmulation: { mix: 1 },
    });
    expect(corruptFlat.nodes.film_emulation.params.filmEmulation).toBeNull();
    expect(corruptFlat.extensions.quarantinedLegacyAdjustments).toEqual({ filmEmulation: { mix: 1 } });
  });

  test('owns strict Film Look identity and migrates old V2 authority idempotently', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      filmLookId: 'film_look.generic.warm_print.v1',
      filmLookStrength: 65,
    });
    expect(document.nodes.film_look.params).toEqual({
      filmLookId: 'film_look.generic.warm_print.v1',
      filmLookStrength: 65,
    });
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('filmLookId');
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('filmLookStrength');
    expect(document.migration?.mapped).toContain('film_look.filmLookId');
    expect(document.migration?.mapped).toContain('film_look.filmLookStrength');
    const reset = resetEditDocumentV2Node(document, 'film_look');
    expect(reset.nodes.film_look.params).toEqual({ filmLookId: null, filmLookStrength: 100 });
    expect(reset.nodes.scene_global_color_tone).toEqual(document.nodes.scene_global_color_tone);

    const oldV2 = structuredClone(document);
    delete (oldV2.nodes as Partial<typeof oldV2.nodes>).film_look;
    Object.assign(oldV2.extensions.legacyAdjustments as Record<string, unknown>, {
      filmLookId: 'film_look.generic.warm_print.v1',
      filmLookStrength: 65,
    });
    if (oldV2.migration === undefined) throw new Error('fixture migration receipt is required');
    oldV2.migration.mapped = oldV2.migration.mapped.filter((path) => !path.startsWith('film_look.'));
    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.film_look.params).toEqual(document.nodes.film_look.params);
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('filmLookId');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptOldV2 = structuredClone(oldV2);
    Object.assign(corruptOldV2.extensions.legacyAdjustments as Record<string, unknown>, {
      filmLookId: 'unknown-look',
      filmLookStrength: Number.NaN,
    });
    const quarantined = editDocumentV2Schema.parse(corruptOldV2);
    expect(quarantined.nodes.film_look.params).toEqual({ filmLookId: null, filmLookStrength: 100 });
    expect(quarantined.extensions.quarantinedLegacyAdjustments).toMatchObject({ filmLookId: 'unknown-look' });
    expect(quarantined.extensions.quarantinedLegacyAdjustments?.filmLookStrength).toBeNaN();
    expect(quarantined.migration?.quarantined).toEqual(expect.arrayContaining(['filmLookId', 'filmLookStrength']));

    const corruptFlat = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      filmLookId: 'film_look.generic.warm_print.v1',
      filmLookStrength: 101,
    });
    expect(corruptFlat.nodes.film_look.params).toEqual({
      filmLookId: 'film_look.generic.warm_print.v1',
      filmLookStrength: 100,
    });
    expect(corruptFlat.extensions.quarantinedLegacyAdjustments).toMatchObject({ filmLookStrength: 101 });
    expect(corruptFlat.migration?.defaulted).toContain('film_look.filmLookStrength');
  });

  test('owns strict Color Presence state and migrates old scene-node fields idempotently', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      hue: -38,
      vibrance: 47,
    });
    expect(document.nodes.color_presence.params).toMatchObject({ hue: -38, saturation: 0, vibrance: 47 });
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('hue');
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('vibrance');
    expect(document.migration?.mapped).toContain('color_presence.hue');
    expect(document.migration?.mapped).toContain('color_presence.vibrance');

    const oldV2 = structuredClone(document);
    const params = oldV2.nodes.scene_global_color_tone.params as Record<string, unknown>;
    params.hue = -38;
    params.saturation = 0;
    params.vibrance = 47;
    delete (oldV2.nodes as Partial<typeof oldV2.nodes>).color_presence;
    if (oldV2.migration === undefined) throw new Error('fixture migration receipt is required');
    oldV2.migration.mapped = oldV2.migration.mapped.filter(
      (path) => path !== 'color_presence.hue' && path !== 'color_presence.vibrance',
    );
    oldV2.migration.quarantined.push('hue', 'vibrance');
    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.color_presence.params).toMatchObject({ hue: -38, saturation: 0, vibrance: 47 });
    expect(reopened.nodes.scene_global_color_tone.params).not.toHaveProperty('saturation');
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('hue');
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('vibrance');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corrupt = structuredClone(oldV2);
    delete (corrupt.nodes as Partial<typeof corrupt.nodes>).color_presence;
    const corruptParams = corrupt.nodes.scene_global_color_tone.params as Record<string, unknown>;
    corruptParams.hue = 181;
    const quarantined = editDocumentV2Schema.parse(corrupt);
    expect(quarantined.nodes.color_presence.params.hue).toBe(0);
    expect(quarantined.extensions.quarantinedLegacyAdjustments?.hue).toBe(181);
    expect(quarantined.migration?.defaulted).toContain('color_presence.hue');

    const invalid = structuredClone(INITIAL_ADJUSTMENTS);
    invalid.vibrance = Number.NaN;
    const invalidLegacy = legacyAdjustmentsToEditDocumentV2(invalid);
    expect(invalidLegacy.nodes.color_presence.params.vibrance).toBe(0);
    expect(invalidLegacy.extensions.quarantinedLegacyAdjustments?.vibrance).toBeNaN();
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

    expect(document.nodes.geometry.params.perspectiveCorrection).toEqual(perspectiveCorrection);
    expect(document.geometry.perspectiveCorrection).toEqual(perspectiveCorrection);
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('perspectiveCorrection');
    expect(document.migration?.mapped).toContain('geometry.perspectiveCorrection');
    expect(compileEditDocumentNodeV2(document.nodes.geometry).params.perspectiveCorrection).toEqual(
      perspectiveCorrection,
    );

    const reset = resetEditDocumentV2Node(document, 'geometry');
    expect(reset.nodes.geometry.params.perspectiveCorrection).toEqual(INITIAL_ADJUSTMENTS.perspectiveCorrection);
    expect(reset.geometry.perspectiveCorrection).toEqual(INITIAL_ADJUSTMENTS.perspectiveCorrection);
    expect(reset.extensions.legacyAdjustments).not.toHaveProperty('perspectiveCorrection');

    const unknown = structuredClone(document);
    unknown.nodes.geometry.params.perspectiveCorrection = { ...perspectiveCorrection, futureProjection: true };
    unknown.geometry.perspectiveCorrection = unknown.nodes.geometry.params.perspectiveCorrection;
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

    expect(document.nodes.black_white_mixer?.params).toEqual({ blackWhiteMixer });
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('blackWhiteMixer');
    expect(document.migration?.mapped).toContain('black_white_mixer.blackWhiteMixer');
    expect(compileEditDocumentNodeV2(document.nodes.black_white_mixer).params).toEqual({ blackWhiteMixer });

    const unknown = structuredClone(document);
    if (unknown.nodes.black_white_mixer) {
      unknown.nodes.black_white_mixer.params.blackWhiteMixer = { ...blackWhiteMixer, futureResponse: true };
    }
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    if (outOfRange.nodes.black_white_mixer) {
      outOfRange.nodes.black_white_mixer.params.blackWhiteMixer = {
        ...blackWhiteMixer,
        weights: { ...blackWhiteMixer.weights, reds: 101 },
      };
    }
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

    expect(document.nodes.channel_mixer?.params).toEqual({ channelMixer });
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('channelMixer');
    expect(document.migration?.mapped).toContain('channel_mixer.channelMixer');
    expect(compileEditDocumentNodeV2(document.nodes.channel_mixer).params).toEqual({ channelMixer });

    const unknown = structuredClone(document);
    if (unknown.nodes.channel_mixer) {
      unknown.nodes.channel_mixer.params.channelMixer = { ...channelMixer, futureMatrix: true };
    }
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    if (outOfRange.nodes.channel_mixer) {
      outOfRange.nodes.channel_mixer.params.channelMixer = {
        ...channelMixer,
        red: { ...channelMixer.red, green: 201 },
      };
    }
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

    expect(document.nodes.color_balance_rgb?.params).toEqual({ colorBalanceRgb });
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('colorBalanceRgb');
    expect(document.migration?.mapped).toContain('color_balance_rgb.colorBalanceRgb');
    expect(compileEditDocumentNodeV2(document.nodes.color_balance_rgb).params).toEqual({ colorBalanceRgb });

    const unknown = structuredClone(document);
    if (unknown.nodes.color_balance_rgb) {
      unknown.nodes.color_balance_rgb.params.colorBalanceRgb = { ...colorBalanceRgb, futureRange: true };
    }
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    if (outOfRange.nodes.color_balance_rgb) {
      outOfRange.nodes.color_balance_rgb.params.colorBalanceRgb = {
        ...colorBalanceRgb,
        highlights: { ...colorBalanceRgb.highlights, blue: 101 },
      };
    }
    expect(() => editDocumentV2Schema.parse(outOfRange)).toThrow();

    const identity = structuredClone(document);
    if (identity.nodes.color_balance_rgb) {
      identity.nodes.color_balance_rgb.params.colorBalanceRgb = {
        ...structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb),
        enabled: true,
      };
    }
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

    expect(document.nodes.luma_levels?.params).toEqual({ levels });
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('levels');
    expect(document.migration?.mapped).toContain('luma_levels.levels');
    expect(compileEditDocumentNodeV2(document.nodes.luma_levels).params).toEqual({ levels });

    const unknown = structuredClone(document);
    if (unknown.nodes.luma_levels) unknown.nodes.luma_levels.params.levels = { ...levels, futurePivot: true };
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    if (outOfRange.nodes.luma_levels) outOfRange.nodes.luma_levels.params.levels.gamma = 5.1;
    expect(() => editDocumentV2Schema.parse(outOfRange)).toThrow();

    const invalidRange = structuredClone(document);
    if (invalidRange.nodes.luma_levels) {
      invalidRange.nodes.luma_levels.params.levels.inputBlack = 0.9;
      invalidRange.nodes.luma_levels.params.levels.inputWhite = 0.9;
    }
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

    expect(document.nodes.selective_color_mixer?.params).toEqual({ hsl, selectiveColorRangeControls });
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('hsl');
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('selectiveColorRangeControls');
    expect(document.migration?.mapped).toEqual(
      expect.arrayContaining(['selective_color_mixer.hsl', 'selective_color_mixer.selectiveColorRangeControls']),
    );
    expect(compileEditDocumentNodeV2(document.nodes.selective_color_mixer).params).toEqual({
      hsl,
      selectiveColorRangeControls,
    });

    const unknown = structuredClone(document);
    if (unknown.nodes.selective_color_mixer) unknown.nodes.selective_color_mixer.params.futureMixer = true;
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    if (outOfRange.nodes.selective_color_mixer) {
      outOfRange.nodes.selective_color_mixer.params.hsl = {
        ...hsl,
        reds: { ...hsl.reds, saturation: 101 },
      };
    }
    expect(() => editDocumentV2Schema.parse(outOfRange)).toThrow();

    const invalidControl = structuredClone(document);
    if (invalidControl.nodes.selective_color_mixer) {
      invalidControl.nodes.selective_color_mixer.params.selectiveColorRangeControls = {
        ...selectiveColorRangeControls,
        reds: { ...selectiveColorRangeControls.reds, centerHueDegrees: 360 },
      };
    }
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

    expect(document.nodes.skin_tone_uniformity?.params).toEqual({ skinToneUniformity });
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('skinToneUniformity');
    expect(document.migration?.mapped).toContain('skin_tone_uniformity.skinToneUniformity');
    expect(compileEditDocumentNodeV2(document.nodes.skin_tone_uniformity).params).toEqual({ skinToneUniformity });

    const unknown = structuredClone(document);
    if (unknown.nodes.skin_tone_uniformity) unknown.nodes.skin_tone_uniformity.params.futureUniformity = true;
    expect(() => editDocumentV2Schema.parse(unknown)).toThrow();

    const outOfRange = structuredClone(document);
    if (outOfRange.nodes.skin_tone_uniformity) {
      outOfRange.nodes.skin_tone_uniformity.params.skinToneUniformity.targetHueDegrees = 360;
    }
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
    expect(document.nodes.lens_correction?.params).toMatchObject({
      chromaticAberrationBlueYellow: -18,
      chromaticAberrationRedCyan: 27,
      lensDistortionAmount: 125,
      lensMaker: 'Fixture Optics',
      lensModel: '35mm Prime',
    });
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('chromaticAberrationBlueYellow');
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('chromaticAberrationRedCyan');
    expect(document.extensions.legacyAdjustments).not.toHaveProperty('lensDistortionAmount');

    for (const [field, value] of [
      ['chromaticAberrationBlueYellow', -101],
      ['chromaticAberrationRedCyan', 101],
      ['lensDistortionAmount', 100.5],
      ['lensTcaAmount', 201],
      ['lensVignetteAmount', -1],
    ] as const) {
      const invalid = structuredClone(document);
      if (invalid.nodes.lens_correction) invalid.nodes.lens_correction.params[field] = value;
      expect(() => editDocumentV2Schema.parse(invalid)).toThrow();
    }
    const invalidCoefficient = structuredClone(document);
    if (invalidCoefficient.nodes.lens_correction) {
      invalidCoefficient.nodes.lens_correction.params.lensDistortionParams = {
        ...document.nodes.lens_correction?.params.lensDistortionParams,
        k1: 10.1,
      };
    }
    expect(() => editDocumentV2Schema.parse(invalidCoefficient)).toThrow();
  });

  test('legacy adapter is deterministic and preserves unmigrated fields in extensions', () => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), customFutureField: { enabled: true } };
    const first = legacyAdjustmentsToEditDocumentV2(adjustments);
    const second = legacyAdjustmentsToEditDocumentV2(adjustments);

    expect(first).toEqual(second);
    const legacyExtensions = first.extensions.legacyAdjustments;
    expect(legacyExtensions && typeof legacyExtensions === 'object' && 'customFutureField' in legacyExtensions).toBe(
      true,
    );
    expect(editDocumentV2ToLegacyAdjustments(first).customFutureField).toEqual({ enabled: true });
  });

  test('migrates legacy Effects visibility into render node enablement without losing latent parameters', () => {
    const legacy = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      effectsEnabled: undefined,
      grainAmount: 42,
      sectionVisibility: { basic: true, color: true, curves: true, details: true, effects: false },
    });

    expect(legacy.nodes.display_creative.enabled).toBeFalse();
    expect(legacy.nodes.display_creative.params.grainAmount).toBe(42);
    expect(legacy.migration).toMatchObject({ disabled: ['display_creative'] });
    expect(legacy.migration?.mapped).toContain('display_creative.enabled');
    expect(legacy.extensions.legacyAdjustments).not.toHaveProperty('effectsEnabled');

    const reenabled = setEditDocumentV2NodeEnabled(legacy, 'display_creative', true);
    expect(reenabled.nodes.display_creative.enabled).toBeTrue();
    expect(reenabled.nodes.display_creative.params).toEqual(legacy.nodes.display_creative.params);
    expect(editDocumentV2ToLegacyAdjustments(reenabled)).toMatchObject({ effectsEnabled: true, grainAmount: 42 });
  });

  test('separates strict source artifacts from provenance and round-trips idempotently', () => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aiPatches: [sourcePatch],
      generatedProfile: { obsolete: true },
      referenceMatchApplicationReceipt: referenceMatchReceipt,
    };
    const first = legacyAdjustmentsToEditDocumentV2(adjustments);
    const reopened = legacyAdjustmentsToEditDocumentV2(editDocumentV2ToLegacyAdjustments(first));

    expect(first.sourceArtifacts.aiPatches).toEqual([sourcePatch]);
    expect(first.nodes.source_artifacts?.params).toEqual(first.sourceArtifacts);
    expect(first.nodes.source_artifacts?.params).not.toHaveProperty('referenceMatchApplicationReceipt');
    expect(first.provenance.referenceMatchApplicationReceipt).toEqual(referenceMatchReceipt);
    expect(first.extensions.legacyAdjustments).toMatchObject({ generatedProfile: { obsolete: true } });
    expect(reopened).toEqual(first);
  });

  test('defaults and strictly validates the render-authoritative layers domain', () => {
    const { masks: _legacyMasks, ...legacyWithoutMasks } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyWithoutMasks);
    expect(defaulted.layers).toEqual({ masks: [] });
    expect(defaulted.nodes.layers?.params).toEqual(defaulted.layers);

    const layer = {
      adjustments: { exposure: 0.4 },
      blendMode: 'overlay' as const,
      id: 'layer-1',
      invert: false,
      name: 'Local sky',
      opacity: 72,
      subMasks: [
        {
          id: 'sub-mask-1',
          invert: false,
          mode: 'additive' as const,
          opacity: 100,
          parameters: { feather: 0.5 },
          type: 'brush' as const,
          visible: true,
        },
      ],
      visible: true,
    };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      masks: [layer],
    });
    const migratedLayer = { ...layer, editNodes: createDefaultMaskEditNodes(), editNodeSchemaVersion: 1 as const };
    expect(document.layers.masks).toEqual([migratedLayer]);
    expect(compileEditDocumentNodeV2(document.nodes.layers).params).toEqual(document.layers);

    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        layers: { masks: [layer, layer] },
        nodes: { ...document.nodes, layers: { ...document.nodes.layers, params: { masks: [layer, layer] } } },
      }),
    ).toThrow('unique');
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        layers: { masks: [{ ...layer, opacity: 101 }] },
        nodes: { ...document.nodes, layers: { ...document.nodes.layers, params: document.layers } },
      }),
    ).toThrow();
    expect(() => editDocumentV2Schema.parse({ ...document, layers: { masks: [] } })).toThrow('disagrees');
  });

  test('reopens pre-envelope V2 layers losslessly and quarantines corrupt edit nodes idempotently', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      masks: [
        {
          adjustments: { exposure: 0.4 },
          id: 'legacy-v2-layer',
          invert: false,
          name: 'Legacy V2 layer',
          opacity: 72,
          subMasks: [],
          visible: true,
        },
      ],
    });
    const {
      editNodes: _editNodes,
      editNodeSchemaVersion: _editNodeSchemaVersion,
      ...legacyLayerEnvelope
    } = document.layers.masks[0] ?? {};
    const legacyLayer = {
      ...legacyLayerEnvelope,
      adjustments: { exposure: 0.4, sectionVisibility: { basic: false, color: true, curves: false, details: true } },
    };
    const reopened = editDocumentV2Schema.parse({
      ...document,
      layers: { masks: [legacyLayer] },
      nodes: { ...document.nodes, layers: { ...document.nodes.layers, params: { masks: [legacyLayer] } } },
    });
    expect(reopened.layers.masks[0]).toMatchObject({
      adjustments: { exposure: 0.4 },
      editNodeSchemaVersion: 1,
      editNodes: {
        basic: { enabled: false },
        color: { enabled: true },
        curves: { enabled: false },
        details: { enabled: true },
      },
    });
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptLayer = { ...legacyLayer, editNodes: { basic: { enabled: 'not-boolean' } } };
    const quarantined = editDocumentV2Schema.parse({
      ...document,
      layers: { masks: [corruptLayer] },
      nodes: { ...document.nodes, layers: { ...document.nodes.layers, params: { masks: [corruptLayer] } } },
    });
    expect(quarantined.layers.masks[0]).toMatchObject({
      adjustments: { exposure: 0.4 },
      editNodeQuarantine: { invalidEditNodes: corruptLayer.editNodes },
      editNodes: {
        basic: { enabled: false },
        color: { enabled: true },
        curves: { enabled: false },
        details: { enabled: true },
      },
    });
    expect(editDocumentV2Schema.parse(quarantined)).toEqual(quarantined);
  });

  test('rejects malformed, duplicate, and ambiguous source artifacts', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aiPatches: [sourcePatch],
    });
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        sourceArtifacts: { aiPatches: [{ ...sourcePatch, unsupported: true }] },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        sourceArtifacts: { aiPatches: [sourcePatch, sourcePatch] },
      }),
    ).toThrow('unique');
    expect(() => editDocumentV2Schema.parse({ ...document, sourceArtifacts: { aiPatches: [] } })).toThrow('disagrees');
  });

  test('strict document schema rejects unknown top-level fields', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(() => editDocumentV2Schema.parse({ ...document, unsupported: true })).toThrow();
  });

  test('scene global tone params are strict, finite, and bounded', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const node = document.nodes.scene_global_color_tone;
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_global_color_tone: { ...node, params: { ...node?.params, exposure: 6 } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_global_color_tone: { ...node, params: { ...node?.params, futureTone: 1 } },
        },
      }),
    ).toThrow();
  });

  test('camera input defaults legacy state and rejects malformed render authority', () => {
    const {
      cameraProfileAmount: _cameraProfileAmount,
      whiteBalanceMigration: _whiteBalanceMigration,
      whiteBalanceTechnical: _whiteBalanceTechnical,
      ...legacyCameraInput
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyCameraInput);
    expect(defaulted.nodes.camera_input?.params).toMatchObject({
      cameraProfile: 'camera_standard',
      cameraProfileAmount: 100,
      whiteBalanceMigration: 'native_v1',
      whiteBalanceTechnical: { contract: 'rapidraw.white_balance.v1', mode: 'as_shot', source: 'as_shot' },
    });
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining([
        'camera_input.cameraProfileAmount',
        'camera_input.whiteBalanceMigration',
        'camera_input.whiteBalanceTechnical',
      ]),
    );

    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const cameraNode = document.nodes.camera_input;
    expect(compileEditDocumentNodeV2(cameraNode).params).toEqual(cameraNode?.params);
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          camera_input: { ...cameraNode, params: { ...cameraNode?.params, cameraProfileAmount: 101 } },
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
              ...cameraNode?.params,
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
          camera_input: { ...cameraNode, params: { ...cameraNode?.params, futureInput: 1 } },
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
    expect(defaulted.nodes.detail_denoise_dehaze?.params).toEqual({
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
    expect(compileEditDocumentNodeV2(defaulted.nodes.detail_denoise_dehaze).params.sharpness).toBe(24);

    const detailNode = defaulted.nodes.detail_denoise_dehaze;
    const {
      deblurEnabled: _enabled,
      deblurSigmaPx: _sigma,
      deblurStrength: _strength,
      ...preDeblurParams
    } = detailNode.params;
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
          detail_denoise_dehaze: { ...detailNode, params: { ...detailNode?.params, futureDetail: true } },
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
            params: { ...detailNode?.params, lumaNoiseReduction: -1 },
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
            detail_denoise_dehaze: { ...detailNode, params: { ...detailNode?.params, ...patch } },
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
    const detailParams = oldV2.nodes.detail_denoise_dehaze.params;
    const legacyAdjustments = oldV2.extensions.legacyAdjustments as Record<string, unknown>;
    const migration = oldV2.migration;
    if (migration === undefined) throw new Error('fixture migration receipt is required');
    legacyAdjustments.sharpnessThreshold = detailParams.sharpnessThreshold;
    delete detailParams.sharpnessThreshold;
    migration.mapped = migration.mapped.filter((path) => path !== 'detail_denoise_dehaze.sharpnessThreshold');
    migration.quarantined.push('sharpnessThreshold');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.detail_denoise_dehaze.params.sharpnessThreshold).toBe(33);
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('sharpnessThreshold');
    expect(reopened.migration?.mapped).toContain('detail_denoise_dehaze.sharpnessThreshold');
    expect(reopened.migration?.quarantined).not.toContain('sharpnessThreshold');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptOldV2 = structuredClone(oldV2);
    (corruptOldV2.extensions.legacyAdjustments as Record<string, unknown>).sharpnessThreshold = 81;
    const quarantined = editDocumentV2Schema.parse(corruptOldV2);
    expect(quarantined.nodes.detail_denoise_dehaze.params.sharpnessThreshold).toBe(15);
    expect(quarantined.extensions.quarantinedLegacyAdjustments).toEqual({ sharpnessThreshold: 81 });
    expect(quarantined.migration?.defaulted).toContain('detail_denoise_dehaze.sharpnessThreshold');
    expect(quarantined.migration?.quarantined).toContain('sharpnessThreshold');

    const corruptFlat = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      sharpnessThreshold: Number.NaN,
    });
    expect(corruptFlat.nodes.detail_denoise_dehaze.params.sharpnessThreshold).toBe(15);
    expect(corruptFlat.extensions.quarantinedLegacyAdjustments).toEqual({ sharpnessThreshold: Number.NaN });
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
    const detailParams = oldV2.nodes.detail_denoise_dehaze.params;
    const legacyAdjustments = oldV2.extensions.legacyAdjustments as Record<string, unknown>;
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
    legacyAdjustments.localContrastRadiusPx = 400;

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.detail_denoise_dehaze.params).toMatchObject({
      centré: -12,
      localContrastHaloGuard: 64,
      localContrastMidtoneMask: 37,
      localContrastRadiusPx: 24,
      structure: 28,
    });
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('structure');
    expect(reopened.extensions.quarantinedLegacyAdjustments).toEqual({ localContrastRadiusPx: 400 });
    expect(reopened.migration?.mapped).toContain('detail_denoise_dehaze.structure');
    expect(reopened.migration?.defaulted).toContain('detail_denoise_dehaze.localContrastRadiusPx');
    expect(reopened.migration?.quarantined).toContain('localContrastRadiusPx');
    expect(reopened.migration?.quarantined).not.toContain('structure');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptFlat = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      localContrastRadiusPx: Number.NaN,
    });
    expect(corruptFlat.nodes.detail_denoise_dehaze.params.localContrastRadiusPx).toBe(24);
    expect(corruptFlat.extensions.quarantinedLegacyAdjustments).toEqual({ localContrastRadiusPx: Number.NaN });
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
    const lensParams = oldV2.nodes.lens_correction.params;
    const legacyAdjustments = oldV2.extensions.legacyAdjustments as Record<string, unknown>;
    const migration = oldV2.migration;
    if (migration === undefined) throw new Error('fixture migration receipt is required');
    for (const field of ['chromaticAberrationBlueYellow', 'chromaticAberrationRedCyan'] as const) {
      legacyAdjustments[field] = lensParams[field];
      delete lensParams[field];
      migration.mapped = migration.mapped.filter((path) => path !== `lens_correction.${field}`);
      migration.quarantined.push(field);
    }
    legacyAdjustments.chromaticAberrationRedCyan = 500;

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.lens_correction.params).toMatchObject({
      chromaticAberrationBlueYellow: -22,
      chromaticAberrationRedCyan: 0,
    });
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('chromaticAberrationBlueYellow');
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('chromaticAberrationRedCyan');
    expect(reopened.extensions.quarantinedLegacyAdjustments).toEqual({ chromaticAberrationRedCyan: 500 });
    expect(reopened.migration?.mapped).toContain('lens_correction.chromaticAberrationBlueYellow');
    expect(reopened.migration?.defaulted).toContain('lens_correction.chromaticAberrationRedCyan');
    expect(reopened.migration?.quarantined).toContain('chromaticAberrationRedCyan');
    expect(reopened.migration?.quarantined).not.toContain('chromaticAberrationBlueYellow');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptFlat = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      chromaticAberrationBlueYellow: Number.NaN,
    });
    expect(corruptFlat.nodes.lens_correction.params.chromaticAberrationBlueYellow).toBe(0);
    expect(corruptFlat.extensions.quarantinedLegacyAdjustments).toEqual({
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
    const oldNodeParams = oldV2.nodes.geometry.params as Record<string, unknown>;
    const oldGeometry = oldV2.geometry as Record<string, unknown>;
    oldV2.extensions.legacyAdjustments.perspectiveCorrection = perspectiveCorrection;
    delete oldNodeParams.perspectiveCorrection;
    delete oldGeometry.perspectiveCorrection;
    if (oldV2.migration === undefined) throw new Error('fixture migration receipt is required');
    oldV2.migration.mapped = oldV2.migration.mapped.filter((path) => path !== 'geometry.perspectiveCorrection');
    oldV2.migration.quarantined.push('perspectiveCorrection');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.geometry.params.perspectiveCorrection).toEqual(perspectiveCorrection);
    expect(reopened.geometry.perspectiveCorrection).toEqual(perspectiveCorrection);
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('perspectiveCorrection');
    expect(reopened.migration?.mapped).toContain('geometry.perspectiveCorrection');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptV2 = structuredClone(document);
    const corrupt = { ...perspectiveCorrection, amount: 500 };
    corruptV2.extensions.legacyAdjustments.perspectiveCorrection = corrupt;
    delete (corruptV2.nodes.geometry.params as Record<string, unknown>).perspectiveCorrection;
    delete (corruptV2.geometry as Record<string, unknown>).perspectiveCorrection;
    if (corruptV2.migration === undefined) throw new Error('fixture migration receipt is required');
    corruptV2.migration.mapped = corruptV2.migration.mapped.filter((path) => path !== 'geometry.perspectiveCorrection');
    corruptV2.migration.quarantined.push('perspectiveCorrection');
    const quarantined = editDocumentV2Schema.parse(corruptV2);
    expect(quarantined.nodes.geometry.params.perspectiveCorrection).toEqual(INITIAL_ADJUSTMENTS.perspectiveCorrection);
    expect(quarantined.geometry.perspectiveCorrection).toEqual(INITIAL_ADJUSTMENTS.perspectiveCorrection);
    expect(quarantined.extensions.quarantinedLegacyAdjustments).toEqual({ perspectiveCorrection: corrupt });
    expect(quarantined.migration?.defaulted).toContain('geometry.perspectiveCorrection');
    expect(quarantined.migration?.quarantined).toContain('perspectiveCorrection');
    expect(editDocumentV2Schema.parse(quarantined)).toEqual(quarantined);

    const corruptFlatAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    corruptFlatAdjustments.perspectiveCorrection.amount = Number.NaN;
    const corruptFlat = legacyAdjustmentsToEditDocumentV2(corruptFlatAdjustments);
    expect(corruptFlat.nodes.geometry.params.perspectiveCorrection).toEqual(INITIAL_ADJUSTMENTS.perspectiveCorrection);
    expect(corruptFlat.extensions.quarantinedLegacyAdjustments).toEqual({
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
    oldV2.extensions.legacyAdjustments.colorBalanceRgb = colorBalanceRgb;
    delete oldV2.nodes.color_balance_rgb;
    migration.mapped = migration.mapped.filter((path) => path !== 'color_balance_rgb.colorBalanceRgb');
    migration.quarantined.push('colorBalanceRgb');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.color_balance_rgb.params).toEqual({ colorBalanceRgb });
    expect(reopened.nodes.color_balance_rgb.enabled).toBe(reopened.nodes.channel_mixer.enabled);
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('colorBalanceRgb');
    expect(reopened.migration?.mapped).toContain('color_balance_rgb.colorBalanceRgb');
    expect(reopened.migration?.quarantined).not.toContain('colorBalanceRgb');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptV2 = structuredClone(document);
    const corrupt = {
      ...colorBalanceRgb,
      midtones: { ...colorBalanceRgb.midtones, green: 500 },
    };
    corruptV2.extensions.legacyAdjustments.colorBalanceRgb = corrupt;
    delete corruptV2.nodes.color_balance_rgb;
    const quarantined = editDocumentV2Schema.parse(corruptV2);
    expect(quarantined.nodes.color_balance_rgb.params.colorBalanceRgb).toEqual(INITIAL_ADJUSTMENTS.colorBalanceRgb);
    expect(quarantined.extensions.quarantinedLegacyAdjustments).toEqual({ colorBalanceRgb: corrupt });
    expect(quarantined.migration?.defaulted).toContain('color_balance_rgb.colorBalanceRgb');
    expect(quarantined.migration?.quarantined).toContain('colorBalanceRgb');
    expect(editDocumentV2Schema.parse(quarantined)).toEqual(quarantined);

    const corruptFlatAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    corruptFlatAdjustments.colorBalanceRgb.midtones.green = Number.NaN;
    const corruptFlat = legacyAdjustmentsToEditDocumentV2(corruptFlatAdjustments);
    expect(corruptFlat.nodes.color_balance_rgb.params.colorBalanceRgb).toEqual(INITIAL_ADJUSTMENTS.colorBalanceRgb);
    expect(corruptFlat.extensions.quarantinedLegacyAdjustments).toEqual({
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
    oldV2.extensions.legacyAdjustments.levels = levels;
    delete oldV2.nodes.luma_levels;
    migration.mapped = migration.mapped.filter((path) => path !== 'luma_levels.levels');
    migration.quarantined.push('levels');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.luma_levels.params).toEqual({ levels });
    expect(reopened.nodes.luma_levels.enabled).toBe(reopened.nodes.channel_mixer.enabled);
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('levels');
    expect(reopened.migration?.mapped).toContain('luma_levels.levels');
    expect(reopened.migration?.quarantined).not.toContain('levels');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptV2 = structuredClone(document);
    const corrupt = { ...levels, gamma: 8 };
    corruptV2.extensions.legacyAdjustments.levels = corrupt;
    delete corruptV2.nodes.luma_levels;
    const quarantined = editDocumentV2Schema.parse(corruptV2);
    expect(quarantined.nodes.luma_levels.params.levels).toEqual(INITIAL_ADJUSTMENTS.levels);
    expect(quarantined.extensions.quarantinedLegacyAdjustments).toEqual({ levels: corrupt });
    expect(quarantined.migration?.defaulted).toContain('luma_levels.levels');
    expect(quarantined.migration?.quarantined).toContain('levels');
    expect(editDocumentV2Schema.parse(quarantined)).toEqual(quarantined);

    const corruptFlatAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    corruptFlatAdjustments.levels.gamma = Number.NaN;
    const corruptFlat = legacyAdjustmentsToEditDocumentV2(corruptFlatAdjustments);
    expect(corruptFlat.nodes.luma_levels.params.levels).toEqual(INITIAL_ADJUSTMENTS.levels);
    expect(corruptFlat.extensions.quarantinedLegacyAdjustments).toEqual({
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
    oldV2.extensions.legacyAdjustments.hsl = hsl;
    oldV2.extensions.legacyAdjustments.selectiveColorRangeControls = selectiveColorRangeControls;
    delete oldV2.nodes.selective_color_mixer;
    migration.mapped = migration.mapped.filter((path) => !path.startsWith('selective_color_mixer.'));
    migration.quarantined.push('hsl', 'selectiveColorRangeControls');

    const reopened = editDocumentV2Schema.parse(oldV2);
    expect(reopened.nodes.selective_color_mixer.params).toEqual({ hsl, selectiveColorRangeControls });
    expect(reopened.nodes.selective_color_mixer.enabled).toBe(reopened.nodes.channel_mixer.enabled);
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('hsl');
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('selectiveColorRangeControls');
    expect(reopened.migration?.mapped).toEqual(
      expect.arrayContaining(['selective_color_mixer.hsl', 'selective_color_mixer.selectiveColorRangeControls']),
    );
    expect(reopened.migration?.quarantined).not.toContain('hsl');
    expect(editDocumentV2Schema.parse(reopened)).toEqual(reopened);

    const corruptV2 = structuredClone(document);
    const corruptHsl = structuredClone(hsl);
    corruptHsl.reds.saturation = 500;
    corruptV2.extensions.legacyAdjustments.hsl = corruptHsl;
    corruptV2.extensions.legacyAdjustments.selectiveColorRangeControls = selectiveColorRangeControls;
    delete corruptV2.nodes.selective_color_mixer;
    const quarantined = editDocumentV2Schema.parse(corruptV2);
    expect(quarantined.nodes.selective_color_mixer.params.hsl).toEqual(INITIAL_ADJUSTMENTS.hsl);
    expect(quarantined.nodes.selective_color_mixer.params.selectiveColorRangeControls).toEqual(
      selectiveColorRangeControls,
    );
    expect(quarantined.extensions.quarantinedLegacyAdjustments).toEqual({ hsl: corruptHsl });
    expect(quarantined.migration?.defaulted).toContain('selective_color_mixer.hsl');
    expect(quarantined.migration?.quarantined).toContain('hsl');
    expect(editDocumentV2Schema.parse(quarantined)).toEqual(quarantined);

    const corruptFlatAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    corruptFlatAdjustments.selectiveColorRangeControls.blues.widthDegrees = Number.NaN;
    const corruptFlat = legacyAdjustmentsToEditDocumentV2(corruptFlatAdjustments);
    expect(corruptFlat.nodes.selective_color_mixer.params.selectiveColorRangeControls).toEqual(
      INITIAL_ADJUSTMENTS.selectiveColorRangeControls,
    );
    expect(corruptFlat.extensions.quarantinedLegacyAdjustments).toEqual({
      selectiveColorRangeControls: corruptFlatAdjustments.selectiveColorRangeControls,
    });
    expect(corruptFlat.migration?.mapped).not.toContain('selective_color_mixer.selectiveColorRangeControls');
  });

  test('display creative owns current Effects state and quarantines stale fields', () => {
    const {
      flareAmount: _flareAmount,
      glowAmount: _glowAmount,
      grainAmount: _grainAmount,
      grainRoughness: _grainRoughness,
      grainSize: _grainSize,
      halationAmount: _halationAmount,
      lutData: _lutData,
      lutIntensity: _lutIntensity,
      lutName: _lutName,
      lutPath: _lutPath,
      lutSize: _lutSize,
      vignetteAmount: _vignetteAmount,
      vignetteFeather: _vignetteFeather,
      vignetteMidpoint: _vignetteMidpoint,
      vignetteRoundness: _vignetteRoundness,
      ...legacyDisplay
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2({
      ...legacyDisplay,
      filmCurve: { obsolete: true },
      vignetteAmount: -32,
    });
    expect(defaulted.nodes.display_creative?.params).toEqual({
      flareAmount: 0,
      glowAmount: 0,
      grainAmount: 0,
      grainRoughness: 50,
      grainSize: 25,
      halationAmount: 0,
      lutData: null,
      lutIntensity: 100,
      lutName: null,
      lutPath: null,
      lutSize: 0,
      vignetteAmount: -32,
      vignetteFeather: 50,
      vignetteMidpoint: 50,
      vignetteRoundness: 0,
    });
    expect(defaulted.extensions.legacyAdjustments).toMatchObject({ filmCurve: { obsolete: true } });
    expect(defaulted.migration?.quarantined).toContain('filmCurve');
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining([
        'display_creative.grainAmount',
        'display_creative.lutIntensity',
        'display_creative.vignetteFeather',
      ]),
    );
    expect(compileEditDocumentNodeV2(defaulted.nodes.display_creative).params.vignetteAmount).toBe(-32);

    const displayNode = defaulted.nodes.display_creative;
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          display_creative: { ...displayNode, params: { ...displayNode?.params, futureDisplay: true } },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          display_creative: { ...displayNode, params: { ...displayNode?.params, vignetteAmount: 101 } },
        },
      }),
    ).toThrow();
  });

  test('tone equalizer defaults legacy state and rejects malformed render authority', () => {
    const { toneEqualizer: _toneEqualizer, ...legacyToneEqualizer } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyToneEqualizer);
    expect(defaulted.nodes.tone_equalizer?.params).toEqual({
      toneEqualizer: {
        autoPlacement: false,
        bandEv: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        detailPreservation: 0.65,
        edgeRefinement: 2,
        enabled: false,
        maskExposureCompensation: 0,
        pivotEv: 0,
        previewMode: 0,
        rangeEv: 16,
        selectedBand: 4,
        smoothingRadius: 32,
      },
    });
    expect(defaulted.migration?.defaulted).toContain('tone_equalizer.toneEqualizer');
    expect(compileEditDocumentNodeV2(defaulted.nodes.tone_equalizer).params.toneEqualizer).toEqual(
      defaulted.nodes.tone_equalizer?.params.toneEqualizer,
    );

    const node = defaulted.nodes.tone_equalizer;
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          tone_equalizer: {
            ...node,
            params: {
              toneEqualizer: { ...defaulted.nodes.tone_equalizer?.params.toneEqualizer, futureBand: true },
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          tone_equalizer: {
            ...node,
            params: {
              toneEqualizer: { ...defaulted.nodes.tone_equalizer?.params.toneEqualizer, selectedBand: 9 },
            },
          },
        },
      }),
    ).toThrow();
  });

  test('point color defaults legacy state and rejects malformed render authority', () => {
    const { pointColor: _pointColor, ...legacyPointColor } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyPointColor);
    expect(defaulted.nodes.point_color?.params).toEqual({ pointColor: INITIAL_ADJUSTMENTS.pointColor });
    expect(defaulted.migration?.defaulted).toContain('point_color.pointColor');
    expect(compileEditDocumentNodeV2(defaulted.nodes.point_color).params.pointColor).toEqual(
      defaulted.nodes.point_color?.params.pointColor,
    );

    const node = defaulted.nodes.point_color;
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          point_color: {
            ...node,
            params: { pointColor: { ...defaulted.nodes.point_color?.params.pointColor, futurePoint: true } },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          point_color: {
            ...node,
            params: {
              pointColor: { ...defaulted.nodes.point_color?.params.pointColor, visualizeMode: 'heatmap' },
            },
          },
        },
      }),
    ).toThrow();
  });

  test('perceptual grading defaults legacy state and rejects malformed render authority', () => {
    const {
      colorGrading: _colorGrading,
      perceptualGradingV1: _perceptualGradingV1,
      ...legacyGrading
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyGrading);
    expect(defaulted.nodes.perceptual_grading?.params).toEqual({
      colorGrading: INITIAL_ADJUSTMENTS.colorGrading,
      perceptualGradingV1: perceptualGradingFromWheelSurface(INITIAL_ADJUSTMENTS.colorGrading),
    });
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining(['perceptual_grading.colorGrading', 'perceptual_grading.perceptualGradingV1']),
    );
    expect(compileEditDocumentNodeV2(defaulted.nodes.perceptual_grading).params).toEqual(
      defaulted.nodes.perceptual_grading?.params,
    );

    const node = defaulted.nodes.perceptual_grading;
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          perceptual_grading: {
            ...node,
            params: { ...node?.params, futureGrading: true },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          perceptual_grading: {
            ...node,
            params: {
              ...node?.params,
              perceptualGradingV1: { ...node?.params.perceptualGradingV1, highlightFulcrumEv: -3 },
            },
          },
        },
      }),
    ).toThrow();
  });

  test('color calibration defaults legacy state and rejects malformed render authority', () => {
    const { colorCalibration: _colorCalibration, ...legacyCalibration } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyCalibration);
    expect(defaulted.nodes.color_calibration?.params).toEqual({
      colorCalibration: INITIAL_ADJUSTMENTS.colorCalibration,
    });
    expect(defaulted.migration?.defaulted).toContain('color_calibration.colorCalibration');
    expect(compileEditDocumentNodeV2(defaulted.nodes.color_calibration).params).toEqual(
      defaulted.nodes.color_calibration?.params,
    );

    const node = defaulted.nodes.color_calibration;
    expect(() =>
      editDocumentV2Schema.parse({
        ...defaulted,
        nodes: {
          ...defaulted.nodes,
          color_calibration: {
            ...node,
            params: { colorCalibration: { ...INITIAL_ADJUSTMENTS.colorCalibration, redHue: 101 } },
          },
        },
      }),
    ).toThrow();
  });

  test('scene curves default legacy state and reject malformed render authority', () => {
    const {
      curveMode: _curveMode,
      curves: _curves,
      parametricCurve: _parametricCurve,
      pointCurves: _pointCurves,
      toneCurve: _toneCurve,
      ...legacyCurves
    } = structuredClone(INITIAL_ADJUSTMENTS);
    const defaulted = legacyAdjustmentsToEditDocumentV2(legacyCurves);
    expect(defaulted.nodes.scene_curve?.params).toMatchObject({
      curveMode: 'point',
      toneCurve: 'auto_filmic',
    });
    expect(defaulted.migration?.defaulted).toEqual(
      expect.arrayContaining([
        'scene_curve.curveMode',
        'scene_curve.curves',
        'scene_curve.parametricCurve',
        'scene_curve.pointCurves',
        'scene_curve.toneCurve',
      ]),
    );

    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      outputCurveV1: {
        domain: 'view_encoded',
        peakNits: 203,
        points: [
          { input: 0, output: 0 },
          { input: 1, output: 1 },
        ],
        sdrReferenceWhiteNits: 203,
        targetIdentity: 'rapid-view-default',
      },
      sceneCurveV1: {
        channelMode: 'luminance_preserving',
        middleGrey: 0.18,
        points: [
          { xEv: -16, yEv: -16 },
          { xEv: 16, yEv: 16 },
        ],
      },
    });
    const sceneNode = document.nodes.scene_curve;
    expect(compileEditDocumentNodeV2(sceneNode).params).toEqual(sceneNode?.params);

    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_curve: {
            ...sceneNode,
            params: {
              ...sceneNode?.params,
              curves: {
                ...INITIAL_ADJUSTMENTS.curves,
                luma: Array.from({ length: 17 }, (_, index) => ({ x: index, y: index })),
              },
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
          scene_curve: {
            ...sceneNode,
            params: {
              ...sceneNode?.params,
              parametricCurve: {
                ...INITIAL_ADJUSTMENTS.parametricCurve,
                luma: { ...INITIAL_ADJUSTMENTS.parametricCurve?.luma, split2: 20 },
              },
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
          scene_curve: {
            ...sceneNode,
            params: {
              ...sceneNode?.params,
              sceneCurveV1: {
                channelMode: 'linked_rgb',
                middleGrey: 0.18,
                points: [
                  { xEv: -1, yEv: 1 },
                  { xEv: 1, yEv: 0 },
                ],
              },
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
          scene_curve: { ...sceneNode, params: { ...sceneNode?.params, futureCurve: true } },
        },
      }),
    ).toThrow();
  });

  test('geometry is strict, bounded, unit-explicit, and atomically mirrored into its domain', () => {
    const legacyPixelCrop = { height: 1800, width: 2400, x: 400, y: 300 };
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      crop: legacyPixelCrop,
    });
    expect(document.geometry.crop).toEqual({ ...legacyPixelCrop, unit: 'px' });
    expect(document.migration?.defaulted).toContain('geometry.crop.unit');
    const reopened = legacyAdjustmentsToEditDocumentV2(editDocumentV2ToLegacyAdjustments(document));
    expect(reopened.geometry).toEqual(document.geometry);
    expect(reopened.nodes.geometry).toEqual(document.nodes.geometry);

    const next = updateEditDocumentV2Node(document, 'geometry', (params) => ({
      ...params,
      crop: { height: 0.7, width: 0.8, x: 0.1, y: 0.2 },
      rotation: 2.5,
    }));
    expect(next.geometry).toEqual(next.nodes.geometry?.params);
    expect(next.geometry.crop).toEqual({ height: 0.7, unit: 'normalized', width: 0.8, x: 0.1, y: 0.2 });
    expect(next.nodes.scene_global_color_tone).toBe(document.nodes.scene_global_color_tone);
    expect(next.provenance).toBe(document.provenance);

    expect(() =>
      editDocumentV2Schema.parse({
        ...next,
        geometry: { ...next.geometry, rotation: 46 },
        nodes: { ...next.nodes, geometry: { ...next.nodes.geometry, params: { ...next.geometry, rotation: 46 } } },
      }),
    ).toThrow();
    expect(() =>
      editDocumentV2Schema.parse({
        ...next,
        geometry: { ...next.geometry, unsupported: true },
        nodes: {
          ...next.nodes,
          geometry: { ...next.nodes.geometry, params: { ...next.geometry, unsupported: true } },
        },
      }),
    ).toThrow();
    expect(() => editDocumentV2Schema.parse({ ...next, geometry: document.geometry })).toThrow('disagrees');
  });

  test('node updates retain unrelated nodes and provenance domains', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const next = editDocumentV2Schema.parse({
      ...document,
      nodes: {
        ...document.nodes,
        scene_global_color_tone: {
          ...document.nodes.scene_global_color_tone,
          params: { ...document.nodes.scene_global_color_tone?.params, exposure: 1 },
        },
      },
      provenance: { referenceMatchApplicationReceipt: null },
    });

    expect(next.nodes.geometry).toEqual(document.nodes.geometry);
    expect(next.provenance).toEqual({ referenceMatchApplicationReceipt: null });
    expect(next.nodes.scene_global_color_tone?.params.exposure).toBe(1);
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
    expect(next.nodes.geometry).toBe(document.nodes.geometry);
    expect(next.nodes.scene_global_color_tone?.params.exposure).toBe(0.25);
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

    expect(renderDocument.nodes.geometry).toBe(authoritative.nodes.geometry);
    expect(renderDocument.geometry).toEqual(authoritative.geometry);
    expect(renderDocument.nodes.scene_global_color_tone).toBe(authoritative.nodes.scene_global_color_tone);
    expect(renderDocument.nodes.scene_global_color_tone?.params.exposure).toBe(1.25);
    expect(renderDocument.nodes.source_artifacts?.params.aiPatches).toEqual([]);
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

    expect(renderDocument.nodes.camera_input).toBe(authoritative.nodes.camera_input);
    expect(renderDocument.nodes.camera_input?.params).toMatchObject({
      cameraProfile: 'camera_neutral',
      whiteBalanceTechnical: { mode: 'chromaticity', source: 'picker' },
    });
    expect(renderDocument.nodes.geometry).toEqual(preparedDocument.nodes.geometry);
    expect(renderDocument.nodes.scene_global_color_tone).toEqual(preparedDocument.nodes.scene_global_color_tone);
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

    expect(renderDocument.nodes.scene_curve).toBe(authoritative.nodes.scene_curve);
    expect(renderDocument.nodes.scene_curve?.params).toMatchObject({
      curveMode: 'parametric',
      toneCurve: 'shadow_lift',
    });
    expect(renderDocument.nodes.camera_input).toEqual(preparedDocument.nodes.camera_input);
    expect(renderDocument.nodes.geometry).toEqual(preparedDocument.nodes.geometry);
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

    expect(renderDocument.nodes.detail_denoise_dehaze).toBe(authoritative.nodes.detail_denoise_dehaze);
    expect(renderDocument.nodes.detail_denoise_dehaze?.params).toMatchObject({
      clarity: 26,
      denoiseShadowBias: -18,
      sharpness: 42,
    });
    expect(renderDocument.nodes.camera_input).toEqual(preparedDocument.nodes.camera_input);
    expect(renderDocument.nodes.scene_curve).toEqual(preparedDocument.nodes.scene_curve);
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

    expect(renderDocument.nodes.display_creative).toBe(authoritative.nodes.display_creative);
    expect(renderDocument.nodes.display_creative?.params).toMatchObject({
      glowAmount: 12,
      grainAmount: 28,
      vignetteAmount: -32,
    });
    expect(renderDocument.nodes.detail_denoise_dehaze).toEqual(preparedDocument.nodes.detail_denoise_dehaze);
    expect(renderDocument.nodes.scene_curve).toEqual(preparedDocument.nodes.scene_curve);
  });

  test('render preparation overlays independent Film Emulation and Film Look authority', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      filmLookId: 'film_look.generic.warm_print.v1',
      filmLookStrength: 65,
    });
    const prepared = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      filmLookId: 'film_look.generic.clean_color.v1',
      filmLookStrength: 25,
    };
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['film_emulation', 'film_look']);

    expect(renderDocument.nodes.film_emulation).toBe(authoritative.nodes.film_emulation);
    expect(renderDocument.nodes.film_look).toBe(authoritative.nodes.film_look);
    expect(renderDocument.nodes.film_look.params).toEqual({
      filmLookId: 'film_look.generic.warm_print.v1',
      filmLookStrength: 65,
    });
    expect(renderDocument.extensions.legacyAdjustments).not.toHaveProperty('filmLookId');
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

    expect(renderDocument.nodes.tone_equalizer).toBe(authoritative.nodes.tone_equalizer);
    expect(renderDocument.nodes.tone_equalizer?.params.toneEqualizer).toMatchObject({
      bandEv: [0, 0, 0, 0, 0.75, 0, 0, 0, 0],
      enabled: true,
    });
    expect(renderDocument.nodes.display_creative).toEqual(preparedDocument.nodes.display_creative);
    expect(renderDocument.nodes.scene_curve).toEqual(preparedDocument.nodes.scene_curve);
  });

  test('render preparation overlays the authoritative point-color envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      pointColor: { ...structuredClone(INITIAL_ADJUSTMENTS.pointColor), enabled: true, visualizeMode: 'range' },
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['point_color']);

    expect(renderDocument.nodes.point_color).toBe(authoritative.nodes.point_color);
    expect(renderDocument.nodes.point_color?.params.pointColor).toMatchObject({
      enabled: true,
      visualizeMode: 'range',
    });
    expect(renderDocument.nodes.display_creative).toEqual(preparedDocument.nodes.display_creative);
    expect(renderDocument.nodes.scene_curve).toEqual(preparedDocument.nodes.scene_curve);
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

    expect(renderDocument.nodes.black_white_mixer).toBe(authoritative.nodes.black_white_mixer);
    expect(renderDocument.nodes.black_white_mixer?.params).toEqual({ blackWhiteMixer });
    expect(renderDocument.nodes.point_color).toEqual(preparedDocument.nodes.point_color);
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

    expect(renderDocument.nodes.channel_mixer).toBe(authoritative.nodes.channel_mixer);
    expect(renderDocument.nodes.channel_mixer?.params).toEqual({ channelMixer });
    expect(renderDocument.nodes.point_color).toEqual(preparedDocument.nodes.point_color);
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

    expect(renderDocument.nodes.color_balance_rgb).toBe(authoritative.nodes.color_balance_rgb);
    expect(renderDocument.nodes.color_balance_rgb?.params).toEqual({ colorBalanceRgb });
    expect(renderDocument.nodes.channel_mixer).toEqual(preparedDocument.nodes.channel_mixer);
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

    expect(renderDocument.nodes.luma_levels).toBe(authoritative.nodes.luma_levels);
    expect(renderDocument.nodes.luma_levels?.params).toEqual({ levels });
    expect(renderDocument.nodes.channel_mixer).toEqual(preparedDocument.nodes.channel_mixer);
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

    expect(renderDocument.nodes.selective_color_mixer).toBe(authoritative.nodes.selective_color_mixer);
    expect(renderDocument.nodes.selective_color_mixer?.params).toEqual({ hsl, selectiveColorRangeControls });
    expect(renderDocument.nodes.color_balance_rgb).toEqual(preparedDocument.nodes.color_balance_rgb);
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

    expect(renderDocument.nodes.perceptual_grading).toBe(authoritative.nodes.perceptual_grading);
    expect(renderDocument.nodes.perceptual_grading?.params).toMatchObject({
      colorGrading: { balance: 20, midtones: { hue: 35, luminance: 5, saturation: 24 } },
      perceptualGradingV1: { balance: 0.2, perceptualModel: 'oklab_d65_from_acescg_v1' },
    });
    expect(renderDocument.nodes.display_creative).toEqual(preparedDocument.nodes.display_creative);
  });

  test('render preparation overlays the authoritative color-calibration envelope', () => {
    const authoritative = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      colorCalibration: { ...INITIAL_ADJUSTMENTS.colorCalibration, redHue: 18 },
    });
    const prepared = structuredClone(INITIAL_ADJUSTMENTS);
    const preparedDocument = legacyAdjustmentsToEditDocumentV2(prepared);
    const renderDocument = prepareEditDocumentV2ForRender(prepared, authoritative, ['color_calibration']);

    expect(renderDocument.nodes.color_calibration).toBe(authoritative.nodes.color_calibration);
    expect(renderDocument.nodes.color_calibration?.params).toMatchObject({ colorCalibration: { redHue: 18 } });
    expect(renderDocument.nodes.display_creative).toEqual(preparedDocument.nodes.display_creative);
  });

  test('render preparation transfers the layers envelope and explicit domain together', () => {
    const layer = {
      adjustments: { saturation: 12 },
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
    const migratedLayer = { ...layer, editNodes: createDefaultMaskEditNodes(), editNodeSchemaVersion: 1 as const };

    expect(renderDocument.nodes.layers).toBe(authoritative.nodes.layers);
    expect(renderDocument.layers).toEqual({ masks: [migratedLayer] });
    expect(renderDocument.nodes.layers?.params).toEqual(renderDocument.layers);
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
    expect(future.document.extensions.quarantinedNodes).toEqual({
      future_color_v9: { enabled: true, params: { exposure: 2 }, process: 'future_v9', type: 'future_color_v9' },
    });
    expect(() =>
      editDocumentV2Schema.parse({
        ...document,
        nodes: {
          ...document.nodes,
          scene_global_color_tone: {
            ...document.nodes.scene_global_color_tone,
            params: { exposure: Number.NaN },
          },
        },
      }),
    ).toThrow('non-finite');
  });

  test('batch edits honor descriptor capability and preserve each document domain', () => {
    const documents = [
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.1 }),
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.2 }),
    ];
    const updated = batchUpdateEditDocumentV2Nodes(documents, 'scene_global_color_tone', (params, index) => ({
      ...params,
      exposure: index + 1,
    }));
    expect(updated?.map((document) => document.nodes.scene_global_color_tone?.params.exposure)).toEqual([1, 2]);
    expect(updated?.[0]?.nodes.geometry).toEqual(documents[0]?.nodes.geometry);
    expect(batchUpdateEditDocumentV2Nodes(documents, 'layers', () => ({}))).toBeNull();
    expect(batchUpdateEditDocumentV2Nodes(documents, 'source_artifacts', () => ({}))).toBeNull();
  });

  test('diagnostics expose node ownership, migration, quarantine, and render fingerprints', () => {
    const document = legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.75 });
    const diagnostics = buildEditDocumentV2Diagnostics({
      ...document,
      extensions: { ...document.extensions, quarantinedNodes: { future_color_v9: { enabled: true } } },
      nodes: {
        ...document.nodes,
        scene_curve: { ...document.nodes.scene_curve, enabled: false },
      },
    });

    expect(diagnostics.schemaVersion).toBe(2);
    expect(diagnostics.activeNodeTypes).toEqual(editDocumentV2NodeInventory(document));
    expect(diagnostics.legacyNodeTypes).toEqual(['lens_correction', 'geometry']);
    expect(diagnostics.nodeDiagnostics.find(({ nodeType }) => nodeType === 'scene_curve')?.status).toBe('disabled');
    expect(diagnostics.quarantinedNodeTypes).toEqual(['future_color_v9']);
    expect(diagnostics.renderStageFingerprints[0]?.fingerprint).toContain('source_decode');
  });

  test('reset uses descriptor defaults and preserves unrelated domains', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure: 1.5,
      contrast: 0.25,
    });
    const reset = resetEditDocumentV2Node(document, 'scene_global_color_tone');

    expect(reset.nodes.scene_global_color_tone?.params).toEqual({
      blacks: 0,
      brightness: 0,
      contrast: 0,
      exposure: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
    });
    expect(reset.nodes.geometry).toEqual(document.nodes.geometry);
    expect(reset.provenance).toEqual(document.provenance);
  });

  test('non-resettable source artifacts remain unchanged', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(resetEditDocumentV2Node(document, 'source_artifacts')).toEqual(document);
  });

  test('source-artifact replacement is atomic and structurally isolates unrelated nodes', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const next = replaceEditDocumentV2SourceArtifacts(document, { aiPatches: [sourcePatch] });

    expect(next.sourceArtifacts.aiPatches).toEqual([sourcePatch]);
    expect(next.nodes.source_artifacts?.params).toEqual(next.sourceArtifacts);
    expect(next.nodes.scene_global_color_tone).toBe(document.nodes.scene_global_color_tone);
    expect(next.nodes.geometry).toBe(document.nodes.geometry);
    expect(next.provenance).toEqual(document.provenance);
  });

  test('focused source-artifact updates and render preparation mirror node authority into the explicit domain', () => {
    const prepared = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const authoritative = updateEditDocumentV2Node(prepared, 'source_artifacts', (params) => ({
      ...params,
      aiPatches: [sourcePatch],
    }));
    expect(authoritative.sourceArtifacts).toEqual(authoritative.nodes.source_artifacts?.params);

    const rendered = prepareEditDocumentV2ForRender(INITIAL_ADJUSTMENTS, authoritative, ['source_artifacts']);
    expect(rendered.nodes.source_artifacts).toBe(authoritative.nodes.source_artifacts);
    expect(rendered.sourceArtifacts).toEqual(authoritative.sourceArtifacts);
    expect(rendered.sourceArtifacts.aiPatches).toEqual([sourcePatch]);
  });

  test('copy and paste derive eligibility from descriptors and isolate node state', () => {
    const document = legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.5 });
    const clipboard = copyEditDocumentV2Node(document, 'scene_global_color_tone');
    expect(clipboard?.params.exposure).toBe(0.5);
    if (clipboard) clipboard.params.exposure = 2;
    expect(document.nodes.scene_global_color_tone?.params.exposure).toBe(0.5);

    const pasted = pasteEditDocumentV2Node(document, 'scene_global_color_tone', clipboard);
    expect(pasted.nodes.scene_global_color_tone?.params.exposure).toBe(2);
    expect(pasted.nodes.geometry).toBe(document.nodes.geometry);
    expect(pasted.provenance).toBe(document.provenance);
    expect(copyEditDocumentV2Node(document, 'source_artifacts')).toBeNull();
  });

  test('builds a descriptor-only multi-node clipboard and lowers only approved compatibility fields', () => {
    const withArtifacts = replaceEditDocumentV2SourceArtifacts(
      legacyAdjustmentsToEditDocumentV2({
        ...structuredClone(INITIAL_ADJUSTMENTS),
        exposure: 1.25,
        referenceMatchApplicationReceipt: referenceMatchReceipt,
      }),
      { aiPatches: [sourcePatch] },
    );
    const source = setEditDocumentV2NodeEnabled(withArtifacts, 'scene_global_color_tone', false);
    const clipboard = copyEditDocumentV2Nodes(source);

    expect(Object.keys(clipboard.nodes)).toContain('scene_global_color_tone');
    expect(clipboard.nodes.scene_global_color_tone).toMatchObject({ enabled: false, params: { exposure: 1.25 } });
    expect(clipboard.nodes).not.toHaveProperty('layers');
    expect(clipboard.nodes).not.toHaveProperty('source_artifacts');
    expect(clipboard).not.toHaveProperty('provenance');
    expect(clipboard).not.toHaveProperty('sourceArtifacts');
    expect(EDIT_DOCUMENT_V2_COPYABLE_LEGACY_FIELDS).not.toContain('masks');
    expect(EDIT_DOCUMENT_V2_COPYABLE_LEGACY_FIELDS).not.toContain('aiPatches');

    const selected = selectEditDocumentV2CopyPayload(clipboard, ['exposure'], true);
    expect(Object.keys(selected.nodes)).toEqual(['scene_global_color_tone']);
    expect(selected.nodes.scene_global_color_tone?.enabled).toBeFalse();
    expect(lowerEditDocumentV2CopyPayloadToLegacyAdjustments(selected)).toMatchObject({ exposure: 1.25 });
    expect(lowerEditDocumentV2CopyPayloadToLegacyAdjustments(selected)).not.toHaveProperty(
      'referenceMatchApplicationReceipt',
    );
  });

  test('preserves disabled state and unrelated structural identity across paste and reopen authority', () => {
    const source = setEditDocumentV2NodeEnabled(
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 2 }),
      'scene_global_color_tone',
      false,
    );
    const clipboard = copyEditDocumentV2Nodes(source, ['exposure']);
    const destination = replaceEditDocumentV2SourceArtifacts(
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: -1 }),
      { aiPatches: [sourcePatch] },
    );
    const pasted = pasteEditDocumentV2Node(
      destination,
      'scene_global_color_tone',
      clipboard.nodes.scene_global_color_tone,
    );

    expect(pasted.nodes.scene_global_color_tone).toMatchObject({ enabled: false, params: { exposure: 2 } });
    expect(pasted.nodes.geometry).toBe(destination.nodes.geometry);
    expect(pasted.nodes.layers).toBe(destination.nodes.layers);
    expect(pasted.nodes.source_artifacts).toBe(destination.nodes.source_artifacts);
    expect(pasted.sourceArtifacts).toBe(destination.sourceArtifacts);
    expect(editDocumentV2Schema.parse(structuredClone(pasted))).toEqual(pasted);
    expect(
      prepareEditDocumentV2ForRender(INITIAL_ADJUSTMENTS, pasted, ['scene_global_color_tone']).nodes,
    ).toHaveProperty('scene_global_color_tone.enabled', false);
  });

  test('rejects malformed or cross-node clipboard payloads without mutation', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(
      pasteEditDocumentV2Node(document, 'scene_global_color_tone', {
        enabled: true,
        implementationVersion: 1,
        params: { exposure: 2 },
        process: 'scene_referred_v2',
        type: 'geometry',
      }),
    ).toEqual(document);
    expect(pasteEditDocumentV2Node(document, 'scene_global_color_tone', { invalid: true })).toEqual(document);
  });

  test('compiles graph nodes in descriptor order with render-stage authority', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const compiled = compileEditDocumentV2(document);
    expect(compiled.map(({ nodeType }) => nodeType)).toEqual(editDocumentV2NodeInventory(document));
    expect(compiled.find(({ nodeType }) => nodeType === 'geometry')).toMatchObject({
      nodeType: 'geometry',
      process: 'legacy_pipeline_v1',
      renderStage: 'geometry',
    });
  });

  test('rejects unsupported node process/version before render compilation', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(() =>
      compileEditDocumentNodeV2({
        ...document.nodes.geometry,
        process: 'scene_referred_v2',
      }),
    ).toThrow('incompatible process');
    expect(() =>
      compileEditDocumentNodeV2({
        ...document.nodes.geometry,
        implementationVersion: 2,
      }),
    ).toThrow('unsupported version');
    expect(() =>
      compileEditDocumentNodeV2({
        ...document.nodes.scene_global_color_tone,
        params: { ...document.nodes.scene_global_color_tone?.params, exposure: 6 },
      }),
    ).toThrow();
  });
});
