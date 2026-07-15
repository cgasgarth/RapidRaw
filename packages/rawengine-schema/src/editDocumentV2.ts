import { z } from 'zod';
import { blackWhiteMixerSettingsSchema } from './color/blackWhiteMixerSchemas.js';
import { channelMixerSettingsSchema } from './color/channelMixerSchemas.js';
import { colorBalanceRgbSettingsSchema } from './color/colorBalanceRgbSchemas.js';
import { levelsSettingsSchema } from './color/levelsSchemas.js';
import { perceptualGradingSettingsV1Schema } from './color/perceptualGradingSchemas.js';
import { pointColorPlanV1Schema } from './color/pointColorSchemas.js';
import { selectiveColorMixerSettingsSchema } from './color/selectiveColorMixerSchemas.js';
import { perspectiveCorrectionSettingsSchema } from './geometry/perspective/perspectiveSchemas.js';
import {
  detailDeblurUiControlsV1Schema,
  lensProfileDistortionParamsV1Schema,
  lensProfilePatchV1Schema,
} from './rawEngineSchemas.js';
import { matchLookApplicationReceiptV1Schema } from './referenceMatchRuntime.js';
import { toneEqualizerSettingsV1Schema } from './tone/toneEqualizerSchemas.js';

export const EDIT_DOCUMENT_V2_SCHEMA_VERSION = 2;

export const sceneGlobalColorToneParamsV2Schema = z
  .object({
    blacks: z.number().finite().min(-100).max(100),
    brightness: z.number().finite().min(-5).max(5),
    contrast: z.number().finite().min(-100).max(100),
    exposure: z.number().finite().min(-5).max(5),
    highlights: z.number().finite().min(-100).max(100),
    saturation: z.number().finite().min(-100).max(100),
    shadows: z.number().finite().min(-100).max(100),
    whites: z.number().finite().min(-100).max(100),
  })
  .strict();

export const editDocumentLocalContrastV2Schema = z
  .object({
    centré: z.number().finite().min(-100).max(100),
    localContrastHaloGuard: z.number().finite().min(0).max(100),
    localContrastMidtoneMask: z.number().finite().min(0).max(100),
    localContrastRadiusPx: z.number().finite().min(4).max(96),
    structure: z.number().finite().min(-100).max(100),
  })
  .strict();

export const EDIT_DOCUMENT_LOCAL_CONTRAST_DEFAULTS = {
  centré: 0,
  localContrastHaloGuard: 50,
  localContrastMidtoneMask: 50,
  localContrastRadiusPx: 24,
  structure: 0,
} as const;

export const EDIT_DOCUMENT_LOCAL_CONTRAST_FIELDS = Object.keys(
  EDIT_DOCUMENT_LOCAL_CONTRAST_DEFAULTS,
) as (keyof typeof EDIT_DOCUMENT_LOCAL_CONTRAST_DEFAULTS)[];

export const editDocumentDetailDenoiseDehazeV2Schema = z
  .object({
    clarity: z.number().finite().min(-100).max(100),
    colorNoiseReduction: z.number().finite().min(0).max(100),
    // Optional only for already-persisted v2 Detail nodes created before Deblur ownership.
    deblurEnabled: detailDeblurUiControlsV1Schema.shape.deblurEnabled.optional(),
    deblurSigmaPx: detailDeblurUiControlsV1Schema.shape.deblurSigmaPx.optional(),
    deblurStrength: detailDeblurUiControlsV1Schema.shape.deblurStrength.optional(),
    dehaze: z.number().finite().min(-100).max(100),
    denoiseContrastProtection: z.number().finite().min(0).max(100),
    denoiseDetail: z.number().finite().min(0).max(100),
    denoiseNaturalGrain: z.number().finite().min(0).max(100),
    denoiseShadowBias: z.number().finite().min(-100).max(100),
    lumaNoiseReduction: z.number().finite().min(0).max(100),
    sharpness: z.number().finite().min(-100).max(100),
    ...editDocumentLocalContrastV2Schema.shape,
  })
  .strict();

export const editDocumentDisplayCreativeV2Schema = z
  .object({
    flareAmount: z.number().finite().min(0).max(100),
    glowAmount: z.number().finite().min(0).max(100),
    grainAmount: z.number().finite().min(0).max(100),
    grainRoughness: z.number().finite().min(0).max(100),
    grainSize: z.number().finite().min(0).max(100),
    halationAmount: z.number().finite().min(0).max(100),
    lutData: z.string().nullable(),
    lutIntensity: z.number().finite().min(0).max(100),
    lutName: z.string().nullable(),
    lutPath: z.string().nullable(),
    lutSize: z.number().int().min(0).max(4_294_967_295),
    vignetteAmount: z.number().finite().min(-100).max(100),
    vignetteFeather: z.number().finite().min(0).max(100),
    vignetteMidpoint: z.number().finite().min(0).max(100),
    vignetteRoundness: z.number().finite().min(-100).max(100),
  })
  .strict();

export const editDocumentToneEqualizerV2Schema = z.object({ toneEqualizer: toneEqualizerSettingsV1Schema }).strict();
export const editDocumentPointColorV2Schema = z.object({ pointColor: pointColorPlanV1Schema }).strict();

export const editDocumentBlackWhiteMixerV2Schema = z
  .object({ blackWhiteMixer: blackWhiteMixerSettingsSchema })
  .strict();
export const editDocumentChannelMixerV2Schema = z.object({ channelMixer: channelMixerSettingsSchema }).strict();
export const editDocumentColorBalanceRgbV2Schema = z
  .object({ colorBalanceRgb: colorBalanceRgbSettingsSchema })
  .strict();

export const EDIT_DOCUMENT_COLOR_BALANCE_RGB_DEFAULTS = {
  colorBalanceRgb: {
    enabled: false,
    highlights: { blue: 0, green: 0, red: 0 },
    midtones: { blue: 0, green: 0, red: 0 },
    preserveLuminance: true,
    shadows: { blue: 0, green: 0, red: 0 },
  },
} as const;

export const EDIT_DOCUMENT_COLOR_BALANCE_RGB_FIELDS = ['colorBalanceRgb'] as const;
export const editDocumentLumaLevelsV2Schema = z.object({ levels: levelsSettingsSchema }).strict();

export const EDIT_DOCUMENT_LUMA_LEVELS_DEFAULTS = {
  levels: {
    enabled: false,
    gamma: 1,
    inputBlack: 0,
    inputWhite: 1,
    outputBlack: 0,
    outputWhite: 1,
  },
} as const;

export const EDIT_DOCUMENT_LUMA_LEVELS_FIELDS = ['levels'] as const;

export const editDocumentSelectiveColorMixerV2Schema = selectiveColorMixerSettingsSchema;

const NEUTRAL_SELECTIVE_COLOR_HSL = { hue: 0, luminance: 0, saturation: 0 } as const;
export const EDIT_DOCUMENT_SELECTIVE_COLOR_MIXER_DEFAULTS = {
  hsl: {
    aquas: NEUTRAL_SELECTIVE_COLOR_HSL,
    blues: NEUTRAL_SELECTIVE_COLOR_HSL,
    greens: NEUTRAL_SELECTIVE_COLOR_HSL,
    magentas: NEUTRAL_SELECTIVE_COLOR_HSL,
    oranges: NEUTRAL_SELECTIVE_COLOR_HSL,
    purples: NEUTRAL_SELECTIVE_COLOR_HSL,
    reds: NEUTRAL_SELECTIVE_COLOR_HSL,
    yellows: NEUTRAL_SELECTIVE_COLOR_HSL,
  },
  selectiveColorRangeControls: {
    aquas: { centerHueDegrees: 180, falloffSmoothness: 1.5, widthDegrees: 60 },
    blues: { centerHueDegrees: 225, falloffSmoothness: 1.5, widthDegrees: 60 },
    greens: { centerHueDegrees: 115, falloffSmoothness: 1.5, widthDegrees: 90 },
    magentas: { centerHueDegrees: 330, falloffSmoothness: 1.5, widthDegrees: 50 },
    oranges: { centerHueDegrees: 25, falloffSmoothness: 1.5, widthDegrees: 45 },
    purples: { centerHueDegrees: 280, falloffSmoothness: 1.5, widthDegrees: 55 },
    reds: { centerHueDegrees: 358, falloffSmoothness: 1.5, widthDegrees: 35 },
    yellows: { centerHueDegrees: 60, falloffSmoothness: 1.5, widthDegrees: 40 },
  },
} as const;

export const EDIT_DOCUMENT_SELECTIVE_COLOR_MIXER_FIELDS = ['hsl', 'selectiveColorRangeControls'] as const;

const legacyColorGradingRangeV2Schema = z
  .object({
    hue: z.number().finite().min(0).max(360),
    luminance: z.number().finite().min(-100).max(100),
    saturation: z.number().finite().min(0).max(100),
  })
  .strict();

export const editDocumentPerceptualGradingV2Schema = z
  .object({
    colorGrading: z
      .object({
        balance: z.number().finite().min(-100).max(100),
        blending: z.number().finite().min(0).max(100),
        global: legacyColorGradingRangeV2Schema,
        highlights: legacyColorGradingRangeV2Schema,
        midtones: legacyColorGradingRangeV2Schema,
        shadows: legacyColorGradingRangeV2Schema,
      })
      .strict(),
    perceptualGradingV1: perceptualGradingSettingsV1Schema,
  })
  .strict();

export const editDocumentColorCalibrationV2Schema = z
  .object({
    colorCalibration: z
      .object({
        blueHue: z.number().finite().min(-100).max(100),
        blueSaturation: z.number().finite().min(-100).max(100),
        greenHue: z.number().finite().min(-100).max(100),
        greenSaturation: z.number().finite().min(-100).max(100),
        redHue: z.number().finite().min(-100).max(100),
        redSaturation: z.number().finite().min(-100).max(100),
        shadowsTint: z.number().finite().min(-100).max(100),
      })
      .strict(),
  })
  .strict();

const editDocumentLegacyCurvePointV2Schema = z
  .object({ x: z.number().finite().min(0).max(255), y: z.number().finite().min(0).max(255) })
  .strict();

const editDocumentLegacyCurveChannelV2Schema = z
  .array(editDocumentLegacyCurvePointV2Schema)
  .min(2)
  .max(16)
  .superRefine((points, context) => {
    for (let index = 1; index < points.length; index += 1) {
      if ((points[index]?.x ?? 0) <= (points[index - 1]?.x ?? 0)) {
        context.addIssue({ code: 'custom', message: 'Curve x coordinates must increase.', path: [index, 'x'] });
      }
    }
  });

export const editDocumentLegacyCurvesV2Schema = z
  .object({
    blue: editDocumentLegacyCurveChannelV2Schema,
    green: editDocumentLegacyCurveChannelV2Schema,
    luma: editDocumentLegacyCurveChannelV2Schema,
    red: editDocumentLegacyCurveChannelV2Schema,
  })
  .strict();

const editDocumentParametricCurveChannelV2Schema = z
  .object({
    blackLevel: z.number().finite().min(0).max(100),
    darks: z.number().finite().min(-100).max(100),
    highlights: z.number().finite().min(-100).max(100),
    lights: z.number().finite().min(-100).max(100),
    shadows: z.number().finite().min(-100).max(100),
    split1: z.number().finite().min(0).max(100),
    split2: z.number().finite().min(0).max(100),
    split3: z.number().finite().min(0).max(100),
    whiteLevel: z.number().finite().min(-100).max(0),
  })
  .strict()
  .refine(({ split1, split2, split3 }) => split1 < split2 && split2 < split3, {
    message: 'Parametric curve splits must increase.',
  });

export const editDocumentParametricCurveV2Schema = z
  .object({
    blue: editDocumentParametricCurveChannelV2Schema,
    green: editDocumentParametricCurveChannelV2Schema,
    luma: editDocumentParametricCurveChannelV2Schema,
    red: editDocumentParametricCurveChannelV2Schema,
  })
  .strict();

export const editDocumentSceneCurveSettingsV1Schema = z
  .object({
    channelMode: z.enum(['luminance_preserving', 'linked_rgb']),
    middleGrey: z.number().finite().min(1e-6).max(1),
    points: z
      .array(
        z
          .object({
            xEv: z.number().finite().min(-16).max(16),
            yEv: z.number().finite().min(-16).max(16),
          })
          .strict(),
      )
      .min(2)
      .max(32),
  })
  .strict()
  .superRefine(({ points }, context) => {
    for (let index = 1; index < points.length; index += 1) {
      const current = points[index];
      const previous = points[index - 1];
      if (current === undefined || previous === undefined) continue;
      if (current.xEv - previous.xEv < 1 / 4096) {
        context.addIssue({
          code: 'custom',
          message: 'Scene-curve xEv values must increase.',
          path: ['points', index, 'xEv'],
        });
      }
      if (current.yEv < previous.yEv) {
        context.addIssue({
          code: 'custom',
          message: 'Scene-curve yEv values must not decrease.',
          path: ['points', index, 'yEv'],
        });
      }
    }
  });

export const editDocumentOutputCurveSettingsV1Schema = z
  .object({
    domain: z.enum(['view_encoded', 'output_encoded']),
    peakNits: z.number().finite().positive().max(10_000),
    points: z
      .array(z.object({ input: z.number().finite().nonnegative(), output: z.number().finite().nonnegative() }).strict())
      .min(2)
      .max(32),
    sdrReferenceWhiteNits: z.number().finite().positive().max(10_000),
    targetIdentity: z
      .string()
      .min(1)
      .refine((value) => new TextEncoder().encode(value).length <= 128, {
        message: 'Target identity must contain at most 128 bytes.',
      }),
  })
  .strict()
  .superRefine(({ peakNits, points, sdrReferenceWhiteNits }, context) => {
    if (peakNits < sdrReferenceWhiteNits) {
      context.addIssue({
        code: 'custom',
        message: 'Peak luminance must cover SDR reference white.',
        path: ['peakNits'],
      });
      return;
    }
    const headroom = peakNits / sdrReferenceWhiteNits;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const previous = points[index - 1];
      if (current === undefined) continue;
      if (current.input > headroom || current.output > headroom) {
        context.addIssue({
          code: 'custom',
          message: 'Output-curve point exceeds target headroom.',
          path: ['points', index],
        });
      }
      if (previous !== undefined && current.input - previous.input < 1 / 65_536) {
        context.addIssue({
          code: 'custom',
          message: 'Output-curve inputs must increase.',
          path: ['points', index, 'input'],
        });
      }
      if (previous !== undefined && current.output < previous.output) {
        context.addIssue({
          code: 'custom',
          message: 'Output-curve outputs must not decrease.',
          path: ['points', index, 'output'],
        });
      }
    }
  });

export const editDocumentSceneCurveV2Schema = z
  .object({
    curveMode: z.enum(['point', 'parametric']),
    curves: editDocumentLegacyCurvesV2Schema,
    outputCurveV1: editDocumentOutputCurveSettingsV1Schema.optional(),
    parametricCurve: editDocumentParametricCurveV2Schema,
    pointCurves: editDocumentLegacyCurvesV2Schema,
    sceneCurveV1: editDocumentSceneCurveSettingsV1Schema.optional(),
    toneCurve: z.enum(['auto_filmic', 'linear', 'soft_contrast', 'high_contrast', 'shadow_lift']),
  })
  .strict();

const DEFAULT_EDIT_DOCUMENT_CURVES_V2 = {
  blue: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  luma: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
} as const;

const DEFAULT_EDIT_DOCUMENT_PARAMETRIC_CURVES_V2 = Object.fromEntries(
  ['blue', 'green', 'luma', 'red'].map((channel) => [
    channel,
    {
      blackLevel: 0,
      darks: 0,
      highlights: 0,
      lights: 0,
      shadows: 0,
      split1: 25,
      split2: 50,
      split3: 75,
      whiteLevel: 0,
    },
  ]),
);

const editDocumentGeometryCropCoordinatesV2Schema = z.object({
  height: z.number().finite().positive(),
  width: z.number().finite().positive(),
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
});

export const editDocumentGeometryCropV2Schema = z
  .discriminatedUnion('unit', [
    editDocumentGeometryCropCoordinatesV2Schema.extend({ unit: z.literal('px') }).strict(),
    editDocumentGeometryCropCoordinatesV2Schema.extend({ unit: z.literal('%') }).strict(),
    editDocumentGeometryCropCoordinatesV2Schema.extend({ unit: z.literal('normalized') }).strict(),
  ])
  .superRefine((crop, context) => {
    const maximum = crop.unit === '%' ? 100 : crop.unit === 'normalized' ? 1 : null;
    if (maximum === null) return;
    if (crop.x + crop.width > maximum) {
      context.addIssue({
        code: 'custom',
        message: `Crop x + width must not exceed ${String(maximum)}.`,
        path: ['width'],
      });
    }
    if (crop.y + crop.height > maximum) {
      context.addIssue({
        code: 'custom',
        message: `Crop y + height must not exceed ${String(maximum)}.`,
        path: ['height'],
      });
    }
  });

export const EDIT_DOCUMENT_PERSPECTIVE_CORRECTION_DEFAULTS = {
  perspectiveCorrection: {
    amount: 100,
    cropPolicy: 'auto_crop',
    guides: [],
    mode: 'off',
    resolvedPlan: null,
  },
} as const;

export const EDIT_DOCUMENT_PERSPECTIVE_CORRECTION_FIELDS = ['perspectiveCorrection'] as const;
export const editDocumentPerspectiveCorrectionV2Schema = z
  .object({ perspectiveCorrection: perspectiveCorrectionSettingsSchema })
  .strict();

export const editDocumentGeometryV2Schema = z
  .object({
    aspectRatio: z.number().finite().positive().nullable(),
    crop: editDocumentGeometryCropV2Schema.nullable(),
    flipHorizontal: z.boolean(),
    flipVertical: z.boolean(),
    orientationSteps: z.number().int().min(0).max(3),
    perspectiveCorrection: perspectiveCorrectionSettingsSchema.default(() => ({
      ...EDIT_DOCUMENT_PERSPECTIVE_CORRECTION_DEFAULTS.perspectiveCorrection,
      guides: [],
    })),
    rotation: z.number().finite().min(-45).max(45),
    transformAspect: z.number().finite().min(-100).max(100).default(0),
    transformDistortion: z.number().finite().min(-100).max(100).default(0),
    transformHorizontal: z.number().finite().min(-100).max(100).default(0),
    transformRotate: z.number().finite().min(-45).max(45).default(0),
    transformScale: z.number().finite().min(0.1).max(150).default(100),
    transformVertical: z.number().finite().min(-100).max(100).default(0),
    transformXOffset: z.number().finite().min(-100).max(100).default(0),
    transformYOffset: z.number().finite().min(-100).max(100).default(0),
  })
  .strict();

export const editDocumentLensDistortionParamsV2Schema = lensProfileDistortionParamsV1Schema;
export const editDocumentManualChromaticAberrationV2Schema = z
  .object({
    chromaticAberrationBlueYellow: z.number().finite().min(-100).max(100),
    chromaticAberrationRedCyan: z.number().finite().min(-100).max(100),
  })
  .strict();

export const EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_DEFAULTS = {
  chromaticAberrationBlueYellow: 0,
  chromaticAberrationRedCyan: 0,
} as const;

export const EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_FIELDS = Object.keys(
  EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_DEFAULTS,
) as (keyof typeof EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_DEFAULTS)[];

export const editDocumentLensCorrectionV2Schema = z
  .object({
    ...editDocumentManualChromaticAberrationV2Schema.shape,
    lensCorrectionMode: lensProfilePatchV1Schema.shape.lensCorrectionMode.unwrap(),
    lensDistortionAmount: lensProfilePatchV1Schema.shape.lensDistortionAmount.unwrap(),
    lensDistortionEnabled: lensProfilePatchV1Schema.shape.lensDistortionEnabled.unwrap(),
    lensDistortionParams: lensProfilePatchV1Schema.shape.lensDistortionParams.unwrap(),
    lensMaker: lensProfilePatchV1Schema.shape.lensMaker.unwrap(),
    lensModel: lensProfilePatchV1Schema.shape.lensModel.unwrap(),
    lensTcaAmount: lensProfilePatchV1Schema.shape.lensTcaAmount.unwrap(),
    lensTcaEnabled: lensProfilePatchV1Schema.shape.lensTcaEnabled.unwrap(),
    lensVignetteAmount: lensProfilePatchV1Schema.shape.lensVignetteAmount.unwrap(),
    lensVignetteEnabled: lensProfilePatchV1Schema.shape.lensVignetteEnabled.unwrap(),
  })
  .strict()
  .refine(({ lensMaker, lensModel }) => lensModel === null || lensMaker !== null, {
    message: 'Lens model cannot be set while lens maker is cleared.',
  });

export const EDIT_DOCUMENT_NODE_DESCRIPTORS = [
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
      blacks: 0,
      brightness: 0,
      contrast: 0,
      exposure: 0,
      highlights: 0,
      saturation: 0,
      shadows: 0,
      whites: 0,
    },
    editorSection: 'basic',
    legacyFields: ['blacks', 'brightness', 'contrast', 'exposure', 'highlights', 'saturation', 'shadows', 'whites'],
    nodeType: 'scene_global_color_tone',
    process: 'scene_referred_v2',
    renderStage: 'scene_global_color_tone',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
      curveMode: 'point',
      curves: DEFAULT_EDIT_DOCUMENT_CURVES_V2,
      parametricCurve: DEFAULT_EDIT_DOCUMENT_PARAMETRIC_CURVES_V2,
      pointCurves: DEFAULT_EDIT_DOCUMENT_CURVES_V2,
      toneCurve: 'auto_filmic',
    },
    editorSection: 'curves',
    legacyFields: [
      'curveMode',
      'curves',
      'outputCurveV1',
      'parametricCurve',
      'pointCurves',
      'sceneCurveV1',
      'toneCurve',
    ],
    nodeType: 'scene_curve',
    process: 'scene_referred_v2',
    renderStage: 'scene_curve',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
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
    },
    editorSection: 'basic',
    legacyFields: ['toneEqualizer'],
    nodeType: 'tone_equalizer',
    process: 'scene_referred_v2',
    renderStage: 'tone_equalizer',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
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
      vignetteAmount: 0,
      vignetteFeather: 50,
      vignetteMidpoint: 50,
      vignetteRoundness: 0,
    },
    editorSection: 'effects',
    legacyFields: [
      'flareAmount',
      'glowAmount',
      'grainAmount',
      'grainRoughness',
      'grainSize',
      'halationAmount',
      'lutData',
      'lutIntensity',
      'lutName',
      'lutPath',
      'lutSize',
      'vignetteAmount',
      'vignetteFeather',
      'vignetteMidpoint',
      'vignetteRoundness',
    ],
    nodeType: 'display_creative',
    process: 'scene_referred_v2',
    renderStage: 'display_creative',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
      ...EDIT_DOCUMENT_LOCAL_CONTRAST_DEFAULTS,
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
      lumaNoiseReduction: 0,
      sharpness: 0,
    },
    editorSection: 'details',
    legacyFields: [
      'clarity',
      'colorNoiseReduction',
      'deblurEnabled',
      'deblurSigmaPx',
      'deblurStrength',
      'dehaze',
      'denoiseContrastProtection',
      'denoiseDetail',
      'denoiseNaturalGrain',
      'denoiseShadowBias',
      'lumaNoiseReduction',
      'sharpness',
      ...EDIT_DOCUMENT_LOCAL_CONTRAST_FIELDS,
    ],
    nodeType: 'detail_denoise_dehaze',
    process: 'scene_referred_v2',
    renderStage: 'detail_denoise_dehaze',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
      pointColor: {
        enabled: false,
        points: [],
        process: 'rawengine.point-color.oklab-ap1.v1',
        selectedPointId: null,
        skinUniformity: {
          chromaUniformity: 0,
          enabled: false,
          hueUniformity: 0,
          lightnessUniformity: 0,
          preserveExtremes: 0.5,
          range: null,
          target: null,
        },
        visualizeMode: 'image',
      },
    },
    editorSection: 'color',
    legacyFields: ['pointColor'],
    nodeType: 'point_color',
    process: 'scene_referred_v2',
    renderStage: 'point_color',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: EDIT_DOCUMENT_COLOR_BALANCE_RGB_DEFAULTS,
    editorSection: 'color',
    legacyFields: EDIT_DOCUMENT_COLOR_BALANCE_RGB_FIELDS,
    nodeType: 'color_balance_rgb',
    process: 'scene_referred_v2',
    renderStage: 'color_balance_rgb',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: EDIT_DOCUMENT_SELECTIVE_COLOR_MIXER_DEFAULTS,
    editorSection: 'color',
    legacyFields: EDIT_DOCUMENT_SELECTIVE_COLOR_MIXER_FIELDS,
    nodeType: 'selective_color_mixer',
    process: 'scene_referred_v2',
    renderStage: 'selective_color_mixer',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
      blackWhiteMixer: {
        enabled: false,
        presetId: 'manual',
        process: 'legacy_fixed_band_v1',
        sourceClass: 'color_source',
        weights: {
          aquas: 0,
          blues: 0,
          greens: 0,
          magentas: 0,
          oranges: 0,
          purples: 0,
          reds: 0,
          yellows: 0,
        },
      },
    },
    editorSection: 'color',
    legacyFields: ['blackWhiteMixer'],
    nodeType: 'black_white_mixer',
    process: 'scene_referred_v2',
    renderStage: 'black_white_mixer',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
      channelMixer: {
        blue: { blue: 100, constant: 0, green: 0, red: 0 },
        enabled: false,
        green: { blue: 0, constant: 0, green: 100, red: 0 },
        preserveLuminance: false,
        red: { blue: 0, constant: 0, green: 0, red: 100 },
      },
    },
    editorSection: 'color',
    legacyFields: ['channelMixer'],
    nodeType: 'channel_mixer',
    process: 'scene_referred_v2',
    renderStage: 'channel_mixer',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: EDIT_DOCUMENT_LUMA_LEVELS_DEFAULTS,
    editorSection: 'color',
    legacyFields: EDIT_DOCUMENT_LUMA_LEVELS_FIELDS,
    nodeType: 'luma_levels',
    process: 'scene_referred_v2',
    renderStage: 'luma_levels',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
      colorGrading: {
        balance: 0,
        blending: 50,
        global: { hue: 0, luminance: 0, saturation: 0 },
        highlights: { hue: 0, luminance: 0, saturation: 0 },
        midtones: { hue: 0, luminance: 0, saturation: 0 },
        shadows: { hue: 0, luminance: 0, saturation: 0 },
      },
      perceptualGradingV1: {
        balance: 0,
        blending: 0.5,
        falloff: 1,
        global: { brilliance: 0, chroma: 0, hueDegrees: 0, luminanceEv: 0, saturation: 0 },
        highlightFulcrumEv: 2,
        highlights: { brilliance: 0, chroma: 0, hueDegrees: 0, luminanceEv: 0, saturation: 0 },
        midtones: { brilliance: 0, chroma: 0, hueDegrees: 0, luminanceEv: 0, saturation: 0 },
        neutralProtection: 0.5,
        perceptualModel: 'oklab_d65_from_acescg_v1',
        shadowFulcrumEv: -2,
        shadows: { brilliance: 0, chroma: 0, hueDegrees: 0, luminanceEv: 0, saturation: 0 },
        skinProtection: 0,
      },
    },
    editorSection: 'color',
    legacyFields: ['colorGrading', 'perceptualGradingV1'],
    nodeType: 'perceptual_grading',
    process: 'scene_referred_v2',
    renderStage: 'perceptual_grading',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
      cameraProfile: 'camera_standard',
      cameraProfileAmount: 100,
      creativeTemperature: 0,
      creativeTint: 0,
      temperature: 0,
      tint: 0,
      whiteBalanceMigration: 'native_v1',
      whiteBalanceTechnical: {
        adaptation: 'cat16_v1',
        confidence: null,
        contract: 'rapidraw.white_balance.v1',
        duv: 0,
        inputSemantics: 'raw_scene_linear',
        kelvin: 6504,
        mode: 'as_shot',
        presetId: null,
        sampleCount: null,
        source: 'as_shot',
        synchronization: { mode: 'per_image', referenceSourceIdentity: null },
        x: 0.32168,
        y: 0.33767,
      },
    },
    editorSection: 'color',
    legacyFields: [
      'cameraProfile',
      'cameraProfileAmount',
      'creativeTemperature',
      'creativeTint',
      'temperature',
      'tint',
      'whiteBalance',
      'whiteBalanceMigration',
      'whiteBalanceTechnical',
    ],
    nodeType: 'camera_input',
    process: 'scene_referred_v2',
    renderStage: 'camera_input',
    implementationVersion: 1,
  },
  {
    capabilities: {
      batch: true,
      copy: true,
      paste: true,
      preset: 'optional_geometry',
      provenance: 'strip',
      reset: true,
    },
    defaultParams: {
      ...EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_DEFAULTS,
      lensCorrectionMode: 'manual',
      lensDistortionAmount: 100,
      lensDistortionEnabled: true,
      lensDistortionParams: null,
      lensMaker: null,
      lensModel: null,
      lensTcaAmount: 100,
      lensTcaEnabled: true,
      lensVignetteAmount: 100,
      lensVignetteEnabled: true,
    },
    editorSection: null,
    legacyFields: [
      ...EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_FIELDS,
      'lensCorrectionMode',
      'lensDistortionAmount',
      'lensDistortionEnabled',
      'lensDistortionParams',
      'lensMaker',
      'lensModel',
      'lensTcaAmount',
      'lensTcaEnabled',
      'lensVignetteAmount',
      'lensVignetteEnabled',
    ],
    nodeType: 'lens_correction',
    process: 'legacy_pipeline_v1',
    renderStage: 'lens_correction',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, preset: 'creative', provenance: 'strip', reset: true },
    defaultParams: {
      colorCalibration: {
        blueHue: 0,
        blueSaturation: 0,
        greenHue: 0,
        greenSaturation: 0,
        redHue: 0,
        redSaturation: 0,
        shadowsTint: 0,
      },
    },
    editorSection: 'color',
    legacyFields: ['colorCalibration'],
    nodeType: 'color_calibration',
    process: 'scene_referred_v2',
    renderStage: 'color_calibration',
    implementationVersion: 1,
  },
  {
    capabilities: {
      batch: true,
      copy: true,
      paste: true,
      preset: 'optional_geometry',
      provenance: 'strip',
      reset: true,
    },
    defaultParams: {
      aspectRatio: null,
      crop: null,
      flipHorizontal: false,
      flipVertical: false,
      orientationSteps: 0,
      ...EDIT_DOCUMENT_PERSPECTIVE_CORRECTION_DEFAULTS,
      rotation: 0,
      transformAspect: 0,
      transformDistortion: 0,
      transformHorizontal: 0,
      transformRotate: 0,
      transformScale: 100,
      transformVertical: 0,
      transformXOffset: 0,
      transformYOffset: 0,
    },
    editorSection: null,
    legacyFields: [
      'aspectRatio',
      'crop',
      'flipHorizontal',
      'flipVertical',
      'orientationSteps',
      ...EDIT_DOCUMENT_PERSPECTIVE_CORRECTION_FIELDS,
      'rotation',
      'transformAspect',
      'transformDistortion',
      'transformHorizontal',
      'transformRotate',
      'transformScale',
      'transformVertical',
      'transformXOffset',
      'transformYOffset',
    ],
    nodeType: 'geometry',
    process: 'legacy_pipeline_v1',
    renderStage: 'geometry',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: false, copy: false, paste: false, preset: 'exclude', provenance: 'preserve', reset: false },
    defaultParams: { masks: [] },
    editorSection: null,
    legacyFields: ['masks'],
    nodeType: 'layers',
    process: 'scene_referred_v2',
    renderStage: 'layers',
    implementationVersion: 1,
  },
  {
    capabilities: {
      batch: false,
      copy: false,
      paste: false,
      preset: 'exclude',
      provenance: 'regenerate',
      reset: false,
    },
    defaultParams: { aiPatches: [] },
    editorSection: null,
    legacyFields: ['aiPatches'],
    nodeType: 'source_artifacts',
    process: 'scene_referred_v2',
    renderStage: 'source_artifacts',
    implementationVersion: 1,
  },
] as const;

export const editDocumentNodeCapabilitySchema = z.object({
  batch: z.boolean(),
  copy: z.boolean(),
  paste: z.boolean(),
  preset: z.enum(['creative', 'exclude', 'optional_geometry']),
  provenance: z.enum(['preserve', 'regenerate', 'strip']),
  reset: z.boolean(),
});

export const editDocumentNodeDescriptorSchema = z.object({
  capabilities: editDocumentNodeCapabilitySchema,
  defaultParams: z.record(z.string(), z.unknown()),
  editorSection: z.enum(['basic', 'color', 'curves', 'details', 'effects']).nullable(),
  legacyFields: z.array(z.string()),
  nodeType: z.string(),
  process: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
  renderStage: z.string(),
  implementationVersion: z.number().int().positive(),
});

export const editDocumentNodeTypeV2Schema = z.enum(
  EDIT_DOCUMENT_NODE_DESCRIPTORS.map(({ nodeType }) => nodeType) as [string, ...string[]],
);

export const editDocumentNodeEnvelopeV2Schema = z
  .object({
    enabled: z.boolean(),
    implementationVersion: z.number().int().positive(),
    params: z.record(z.string(), z.unknown()),
    process: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
    type: editDocumentNodeTypeV2Schema,
  })
  .strict();

export const editDocumentV2CopyPayloadSchema = z
  .object({
    nodes: z.partialRecord(editDocumentNodeTypeV2Schema, editDocumentNodeEnvelopeV2Schema),
    schemaVersion: z.literal(2),
  })
  .strict()
  .superRefine(({ nodes }, context) => {
    for (const [nodeType, node] of Object.entries(nodes)) {
      const descriptor = EDIT_DOCUMENT_NODE_DESCRIPTORS.find((candidate) => candidate.nodeType === nodeType);
      if (
        descriptor === undefined ||
        !descriptor.capabilities.copy ||
        !descriptor.capabilities.paste ||
        descriptor.capabilities.provenance !== 'strip' ||
        node?.type !== nodeType
      ) {
        context.addIssue({
          code: 'custom',
          message: `Node '${nodeType}' is not transferable.`,
          path: ['nodes', nodeType],
        });
      }
    }
  });

export type EditDocumentJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly EditDocumentJsonValue[]
  | { readonly [key: string]: EditDocumentJsonValue };

export const editDocumentJsonValueSchema: z.ZodType<EditDocumentJsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.null(),
    z.number().finite(),
    z.string(),
    z.array(editDocumentJsonValueSchema),
    z.record(z.string(), editDocumentJsonValueSchema),
  ]),
);

export const editDocumentTechnicalWhiteBalanceV2Schema = z
  .object({
    adaptation: z.literal('cat16_v1'),
    confidence: z.number().finite().min(0).max(1).nullable(),
    contract: z.literal('rapidraw.white_balance.v1'),
    duv: z.number().finite().min(-0.05).max(0.05),
    inputSemantics: z.enum(['raw_scene_linear', 'rendered_scene_linear_approximation']),
    kelvin: z.number().finite().min(1667).max(25000),
    mode: z.enum(['as_shot', 'auto', 'kelvin_tint', 'chromaticity', 'preset']),
    presetId: z.enum(['tungsten', 'daylight', 'flash', 'cloudy', 'shade']).nullable(),
    sampleCount: z.number().int().nonnegative().nullable(),
    source: z.enum(['as_shot', 'auto', 'picker', 'preset', 'user']),
    synchronization: z
      .object({
        mode: z.enum(['per_image', 'locked_reference']),
        referenceSourceIdentity: z.string().trim().min(1).nullable(),
      })
      .strict(),
    x: z.number().finite().gt(0).lt(1),
    y: z.number().finite().gt(0).lt(1),
  })
  .strict()
  .refine(({ x, y }) => x + y < 1, { message: 'Chromaticity x+y must be below one.' });

export const editDocumentCameraInputV2Schema = z
  .object({
    cameraProfile: z.union([
      z.enum(['camera_standard', 'camera_neutral', 'camera_portrait', 'camera_landscape', 'linear_raw']),
      z.string().regex(/^dcp:[a-f0-9]{64}$/u),
    ]),
    cameraProfileAmount: z.number().finite().min(0).max(100),
    creativeTemperature: z.number().finite().min(-100).max(100),
    creativeTint: z.number().finite().min(-100).max(100),
    temperature: z.number().finite().min(-100).max(100),
    tint: z.number().finite().min(-100).max(100),
    whiteBalance: editDocumentJsonValueSchema.optional(),
    whiteBalanceMigration: z.enum(['native_v1', 'legacy_creative_temperature_tint_v1']),
    whiteBalanceTechnical: editDocumentTechnicalWhiteBalanceV2Schema,
  })
  .strict();

export const editDocumentMaskTypeV2Schema = z.enum([
  'ai-depth',
  'ai-foreground',
  'ai-object',
  'ai-person',
  'ai-sky',
  'ai-subject',
  'all',
  'brush',
  'color',
  'flow',
  'linear',
  'luminance',
  'quick-eraser',
  'radial',
]);

export const editDocumentSourceArtifactSubMaskV2Schema = z
  .object({
    id: z.string().trim().min(1),
    invert: z.boolean(),
    mode: z.enum(['additive', 'intersect', 'subtractive']),
    name: z.string().optional(),
    opacity: z.number().finite().min(0).max(100),
    parameters: z.record(z.string(), editDocumentJsonValueSchema).optional(),
    type: editDocumentMaskTypeV2Schema,
    visible: z.boolean(),
  })
  .strict();

export const editDocumentLayerBlendModeV2Schema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft_light',
  'hue',
  'saturation',
  'luminosity',
  'color',
]);

export const editDocumentMaskNodeTypeV2Schema = z.enum(['basic', 'color', 'curves', 'details']);
export const editDocumentMaskNodeEnvelopeV2Schema = z.object({ enabled: z.boolean() }).strict();
export const editDocumentMaskNodesV2Schema = z
  .record(editDocumentMaskNodeTypeV2Schema, editDocumentMaskNodeEnvelopeV2Schema)
  .refine(
    (nodes) => editDocumentMaskNodeTypeV2Schema.options.every((nodeType) => nodes[nodeType] !== undefined),
    'Mask edit nodes must contain every supported node type.',
  );

const defaultEditDocumentMaskNodesV2 = () =>
  editDocumentMaskNodesV2Schema.parse(
    Object.fromEntries(editDocumentMaskNodeTypeV2Schema.options.map((nodeType) => [nodeType, { enabled: true }])),
  );

const editDocumentLayerV2ObjectSchema = z
  .object({
    adjustments: z.record(z.string(), editDocumentJsonValueSchema),
    blendMode: editDocumentLayerBlendModeV2Schema.optional(),
    editNodes: editDocumentMaskNodesV2Schema,
    editNodeQuarantine: z.record(z.string(), editDocumentJsonValueSchema).optional(),
    editNodeSchemaVersion: z.literal(1),
    id: z.string().trim().min(1),
    invert: z.boolean(),
    layerGroupId: z.string().trim().min(1).optional(),
    layerGroupName: z.string().trim().min(1).optional(),
    name: z.string(),
    opacity: z.number().finite().min(0).max(100),
    referenceMatchApplicationReceipt: matchLookApplicationReceiptV1Schema.optional(),
    retouchCloneSource: z.record(z.string(), editDocumentJsonValueSchema).optional(),
    retouchRemoveSource: z.record(z.string(), editDocumentJsonValueSchema).optional(),
    subMasks: z.array(editDocumentSourceArtifactSubMaskV2Schema),
    visible: z.boolean(),
  })
  .strict()
  .superRefine((layer, context) => {
    const subMaskIds = layer.subMasks.map(({ id }) => id);
    if (new Set(subMaskIds).size !== subMaskIds.length) {
      context.addIssue({ code: 'custom', message: 'Layer sub-mask IDs must be unique.', path: ['subMasks'] });
    }
  });

export const editDocumentLayerV2Schema = z.preprocess((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const layer = value as Readonly<Record<string, unknown>>;
  const adjustments =
    layer['adjustments'] !== null && typeof layer['adjustments'] === 'object' && !Array.isArray(layer['adjustments'])
      ? (layer['adjustments'] as Readonly<Record<string, unknown>>)
      : {};
  const legacyVisibility =
    adjustments['sectionVisibility'] !== null &&
    typeof adjustments['sectionVisibility'] === 'object' &&
    !Array.isArray(adjustments['sectionVisibility'])
      ? (adjustments['sectionVisibility'] as Readonly<Record<string, unknown>>)
      : null;
  const { sectionVisibility: _legacyVisibility, ...pixelAdjustments } = adjustments;
  const parsedNodes = editDocumentMaskNodesV2Schema.safeParse(layer['editNodes']);
  const migratedNodes = parsedNodes.success
    ? parsedNodes.data
    : editDocumentMaskNodesV2Schema.parse(
        Object.fromEntries(
          editDocumentMaskNodeTypeV2Schema.options.map((nodeType) => [
            nodeType,
            { enabled: typeof legacyVisibility?.[nodeType] === 'boolean' ? legacyVisibility[nodeType] : true },
          ]),
        ),
      );
  return {
    ...layer,
    adjustments: pixelAdjustments,
    editNodes: migratedNodes,
    ...(layer['editNodes'] !== undefined && !parsedNodes.success
      ? { editNodeQuarantine: { invalidEditNodes: layer['editNodes'] } }
      : {}),
    editNodeSchemaVersion: 1,
  };
}, editDocumentLayerV2ObjectSchema);

export const editDocumentLayersV2Schema = z
  .object({ masks: z.array(editDocumentLayerV2Schema) })
  .strict()
  .superRefine((layers, context) => {
    const layerIds = layers.masks.map(({ id }) => id);
    if (new Set(layerIds).size !== layerIds.length) {
      context.addIssue({ code: 'custom', message: 'Layer IDs must be unique.', path: ['masks'] });
    }
  });

export const editDocumentSourceArtifactAiPatchV2Schema = z
  .object({
    id: z.string().trim().min(1),
    invert: z.boolean(),
    isLoading: z.boolean(),
    name: z.string(),
    patchData: editDocumentJsonValueSchema.nullable(),
    prompt: z.string(),
    subMasks: z.array(editDocumentSourceArtifactSubMaskV2Schema),
    visible: z.boolean(),
  })
  .strict()
  .superRefine((patch, context) => {
    const subMaskIds = patch.subMasks.map(({ id }) => id);
    if (new Set(subMaskIds).size !== subMaskIds.length) {
      context.addIssue({ code: 'custom', message: 'AI patch sub-mask IDs must be unique.', path: ['subMasks'] });
    }
  });

export const editDocumentSourceArtifactsV2Schema = z
  .object({ aiPatches: z.array(editDocumentSourceArtifactAiPatchV2Schema) })
  .strict()
  .superRefine((artifacts, context) => {
    const patchIds = artifacts.aiPatches.map(({ id }) => id);
    if (new Set(patchIds).size !== patchIds.length) {
      context.addIssue({ code: 'custom', message: 'AI patch IDs must be unique.', path: ['aiPatches'] });
    }
  });

export const editDocumentProvenanceV2Schema = z
  .object({ referenceMatchApplicationReceipt: matchLookApplicationReceiptV1Schema.nullable().default(null) })
  .strict();

const sameJsonValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((v, i) => sameJsonValue(v, right[i]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftEntries = Object.entries(left);
  const rightRecord = right as Record<string, unknown>;
  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(([key, value]) => Object.hasOwn(rightRecord, key) && sameJsonValue(value, rightRecord[key]))
  );
};

const editDocumentNodesV2Schema = z
  .record(editDocumentNodeTypeV2Schema, editDocumentNodeEnvelopeV2Schema)
  .superRefine((nodes, context) => {
    for (const [nodeType, node] of Object.entries(nodes)) {
      const descriptor = EDIT_DOCUMENT_NODE_DESCRIPTORS.find((candidate) => candidate.nodeType === nodeType);
      if (descriptor === undefined) continue;
      if (node.type !== nodeType) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Node envelope type must match '${nodeType}'.` });
      }
      if (node.process !== descriptor.process) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Node '${nodeType}' has an incompatible process.` });
      }
      if (node.implementationVersion !== descriptor.implementationVersion) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Node '${nodeType}' has an unsupported version.` });
      }
      if (!hasFiniteJsonValues(node.params)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Node '${nodeType}' contains a non-finite value.` });
      }
      if (nodeType === 'scene_global_color_tone') {
        const parsed = sceneGlobalColorToneParamsV2Schema.safeParse(node.params);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'scene_curve') {
        const sceneCurve = editDocumentSceneCurveV2Schema.safeParse(node.params);
        if (!sceneCurve.success) {
          for (const issue of sceneCurve.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'detail_denoise_dehaze') {
        const detail = editDocumentDetailDenoiseDehazeV2Schema.safeParse(node.params);
        if (!detail.success) {
          for (const issue of detail.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'display_creative') {
        const displayCreative = editDocumentDisplayCreativeV2Schema.safeParse(node.params);
        if (!displayCreative.success) {
          for (const issue of displayCreative.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'tone_equalizer') {
        const toneEqualizer = editDocumentToneEqualizerV2Schema.safeParse(node.params);
        if (!toneEqualizer.success) {
          for (const issue of toneEqualizer.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'point_color') {
        const pointColor = editDocumentPointColorV2Schema.safeParse(node.params);
        if (!pointColor.success) {
          for (const issue of pointColor.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'black_white_mixer') {
        const blackWhiteMixer = editDocumentBlackWhiteMixerV2Schema.safeParse(node.params);
        if (!blackWhiteMixer.success) {
          for (const issue of blackWhiteMixer.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'channel_mixer') {
        const channelMixer = editDocumentChannelMixerV2Schema.safeParse(node.params);
        if (!channelMixer.success) {
          for (const issue of channelMixer.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'color_balance_rgb') {
        const colorBalanceRgb = editDocumentColorBalanceRgbV2Schema.safeParse(node.params);
        if (!colorBalanceRgb.success) {
          for (const issue of colorBalanceRgb.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'luma_levels') {
        const levels = editDocumentLumaLevelsV2Schema.safeParse(node.params);
        if (!levels.success) {
          for (const issue of levels.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'selective_color_mixer') {
        const selectiveColorMixer = editDocumentSelectiveColorMixerV2Schema.safeParse(node.params);
        if (!selectiveColorMixer.success) {
          for (const issue of selectiveColorMixer.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'perceptual_grading') {
        const perceptualGrading = editDocumentPerceptualGradingV2Schema.safeParse(node.params);
        if (!perceptualGrading.success) {
          for (const issue of perceptualGrading.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'color_calibration') {
        const colorCalibration = editDocumentColorCalibrationV2Schema.safeParse(node.params);
        if (!colorCalibration.success) {
          for (const issue of colorCalibration.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'camera_input') {
        const cameraInput = editDocumentCameraInputV2Schema.safeParse(node.params);
        if (!cameraInput.success) {
          for (const issue of cameraInput.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'geometry') {
        const geometry = editDocumentGeometryV2Schema.safeParse(node.params);
        if (!geometry.success) {
          for (const issue of geometry.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'lens_correction') {
        const lensCorrection = editDocumentLensCorrectionV2Schema.safeParse(node.params);
        if (!lensCorrection.success) {
          for (const issue of lensCorrection.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
      if (nodeType === 'source_artifacts') {
        const sourceArtifacts = editDocumentSourceArtifactsV2Schema.safeParse(node.params);
        if (!sourceArtifacts.success) {
          context.addIssue({ code: 'custom', message: "Node 'source_artifacts' contains invalid artifacts." });
        }
      }
      if (nodeType === 'layers') {
        const layers = editDocumentLayersV2Schema.safeParse(node.params);
        if (!layers.success) {
          for (const issue of layers.error.issues) {
            context.addIssue({ ...issue, path: [nodeType, 'params', ...issue.path] });
          }
        }
      }
    }
  });

const editDocumentMigrationReceiptV2Schema = z
  .object({
    defaulted: z.array(z.string()),
    disabled: z.array(z.string()),
    mapped: z.array(z.string()),
    quarantined: z.array(z.string()),
    sourceSchemaVersion: z.literal(1),
  })
  .strict();

const editDocumentV2ObjectSchema = z
  .object({
    extensions: z.record(z.string(), z.unknown()),
    geometry: editDocumentGeometryV2Schema,
    graphProcess: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
    layers: editDocumentLayersV2Schema,
    migration: editDocumentMigrationReceiptV2Schema.optional(),
    nodes: editDocumentNodesV2Schema,
    provenance: editDocumentProvenanceV2Schema,
    schemaVersion: z.literal(EDIT_DOCUMENT_V2_SCHEMA_VERSION),
    sourceArtifacts: editDocumentSourceArtifactsV2Schema,
  })
  .strict()
  .superRefine((document, context) => {
    // biome-ignore lint/complexity/useLiteralKeys: node records intentionally use an index signature.
    const sourceNode = document.nodes['source_artifacts'];
    if (sourceNode !== undefined && !sameJsonValue(sourceNode.params, document.sourceArtifacts)) {
      context.addIssue({ code: 'custom', message: 'Source-artifact domain disagrees with its node params.' });
    }
    // biome-ignore lint/complexity/useLiteralKeys: node records intentionally use an index signature.
    const geometryNode = document.nodes['geometry'];
    if (geometryNode !== undefined && !sameJsonValue(geometryNode.params, document.geometry)) {
      context.addIssue({ code: 'custom', message: 'Geometry domain disagrees with its node params.' });
    }
    // biome-ignore lint/complexity/useLiteralKeys: node records intentionally use an index signature.
    const layersNode = document.nodes['layers'];
    if (layersNode !== undefined && !sameJsonValue(layersNode.params, document.layers)) {
      context.addIssue({ code: 'custom', message: 'Layers domain disagrees with its node params.' });
    }
  });

const isEditDocumentRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface LegacyNodeOwnershipMigration {
  createNode?: {
    enabledFromNodeType: string;
    implementationVersion: number;
    process: 'legacy_pipeline_v1' | 'scene_referred_v2';
  };
  defaults: Readonly<Record<string, unknown>>;
  fields: readonly string[];
  nodeType: string;
  schemas: Readonly<Record<string, z.ZodType>>;
}

const normalizeLegacyNodeOwnership = (
  document: Readonly<Record<string, unknown>>,
  ownership: LegacyNodeOwnershipMigration,
): Readonly<Record<string, unknown>> => {
  const nodes = document['nodes'];
  if (!isEditDocumentRecord(nodes)) return document;
  const existingNode = nodes[ownership.nodeType];
  const enabledSourceNode = nodes[ownership.createNode?.enabledFromNodeType ?? ''];
  const node = isEditDocumentRecord(existingNode)
    ? existingNode
    : ownership.createNode === undefined
      ? undefined
      : {
          enabled:
            isEditDocumentRecord(enabledSourceNode) && typeof enabledSourceNode['enabled'] === 'boolean'
              ? enabledSourceNode['enabled']
              : true,
          implementationVersion: ownership.createNode.implementationVersion,
          params: {},
          process: ownership.createNode.process,
          type: ownership.nodeType,
        };
  if (node === undefined || !isEditDocumentRecord(node['params'])) return document;
  if (!isEditDocumentRecord(document['extensions'])) return document;
  const extensions = { ...document['extensions'] };
  const rawLegacy = extensions['legacyAdjustments'];
  if (rawLegacy !== undefined && !isEditDocumentRecord(rawLegacy)) return document;
  const legacyAdjustments = { ...(rawLegacy ?? {}) };
  const rawQuarantine = extensions['quarantinedLegacyAdjustments'];
  if (rawQuarantine !== undefined && !isEditDocumentRecord(rawQuarantine)) return document;
  const quarantinedLegacyAdjustments = { ...(rawQuarantine ?? {}) };
  const params = { ...node['params'] };
  const mappedPaths: string[] = [];
  const defaultedPaths: string[] = [];
  const quarantinedFields: string[] = [];

  for (const field of ownership.fields) {
    if (Object.hasOwn(params, field)) continue;
    const path = `${ownership.nodeType}.${field}`;
    if (Object.hasOwn(legacyAdjustments, field)) {
      const candidate = legacyAdjustments[field];
      delete legacyAdjustments[field];
      const parsed = ownership.schemas[field]?.safeParse(candidate);
      if (parsed === undefined) return document;
      if (parsed.success) {
        params[field] = parsed.data;
        mappedPaths.push(path);
      } else {
        params[field] = ownership.defaults[field];
        quarantinedLegacyAdjustments[field] = candidate;
        defaultedPaths.push(path);
        quarantinedFields.push(field);
      }
    } else {
      params[field] = ownership.defaults[field];
      defaultedPaths.push(path);
      if (Object.hasOwn(quarantinedLegacyAdjustments, field)) quarantinedFields.push(field);
    }
  }
  if (mappedPaths.length === 0 && defaultedPaths.length === 0) return document;

  extensions['legacyAdjustments'] = legacyAdjustments;
  if (Object.keys(quarantinedLegacyAdjustments).length > 0) {
    extensions['quarantinedLegacyAdjustments'] = quarantinedLegacyAdjustments;
  }
  const parsedMigration = editDocumentMigrationReceiptV2Schema.safeParse(document['migration']);
  const ownedFields = new Set(ownership.fields);
  const migration = parsedMigration.success
    ? {
        ...parsedMigration.data,
        defaulted: [...new Set([...parsedMigration.data.defaulted, ...defaultedPaths])].sort(),
        mapped: [...new Set([...parsedMigration.data.mapped, ...mappedPaths])].sort(),
        quarantined: [
          ...new Set([
            ...parsedMigration.data.quarantined.filter((field) => !ownedFields.has(field)),
            ...quarantinedFields,
          ]),
        ].sort(),
      }
    : document['migration'];

  return {
    ...document,
    extensions,
    migration,
    nodes: { ...nodes, [ownership.nodeType]: { ...node, params } },
  };
};

export const editDocumentV2Schema = z.preprocess((value) => {
  if (!isEditDocumentRecord(value)) return value;
  let document = value;
  const nodes = document['nodes'];
  if (!isEditDocumentRecord(nodes)) return value;
  const layersNode = nodes['layers'];
  if (isEditDocumentRecord(layersNode)) {
    const rawLayers = document['layers'];
    const rawNodeParams = layersNode['params'];
    if (sameJsonValue(rawLayers, rawNodeParams)) {
      const parsedLayers = editDocumentLayersV2Schema.safeParse(rawLayers);
      if (parsedLayers.success) {
        // Legacy V2 documents duplicated the same pre-envelope layer domain in
        // the graph node. Normalize both copies together for deterministic reopen.
        document = {
          ...document,
          layers: parsedLayers.data,
          nodes: { ...nodes, layers: { ...layersNode, params: parsedLayers.data } },
        };
      }
    }
  }
  document = normalizeLegacyNodeOwnership(document, {
    defaults: EDIT_DOCUMENT_LOCAL_CONTRAST_DEFAULTS,
    fields: EDIT_DOCUMENT_LOCAL_CONTRAST_FIELDS,
    nodeType: 'detail_denoise_dehaze',
    schemas: editDocumentLocalContrastV2Schema.shape,
  });
  document = normalizeLegacyNodeOwnership(document, {
    defaults: EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_DEFAULTS,
    fields: EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_FIELDS,
    nodeType: 'lens_correction',
    schemas: editDocumentManualChromaticAberrationV2Schema.shape,
  });
  document = normalizeLegacyNodeOwnership(document, {
    createNode: {
      enabledFromNodeType: 'channel_mixer',
      implementationVersion: 1,
      process: 'scene_referred_v2',
    },
    defaults: EDIT_DOCUMENT_COLOR_BALANCE_RGB_DEFAULTS,
    fields: EDIT_DOCUMENT_COLOR_BALANCE_RGB_FIELDS,
    nodeType: 'color_balance_rgb',
    schemas: editDocumentColorBalanceRgbV2Schema.shape,
  });
  document = normalizeLegacyNodeOwnership(document, {
    createNode: {
      enabledFromNodeType: 'channel_mixer',
      implementationVersion: 1,
      process: 'scene_referred_v2',
    },
    defaults: EDIT_DOCUMENT_LUMA_LEVELS_DEFAULTS,
    fields: EDIT_DOCUMENT_LUMA_LEVELS_FIELDS,
    nodeType: 'luma_levels',
    schemas: editDocumentLumaLevelsV2Schema.shape,
  });
  document = normalizeLegacyNodeOwnership(document, {
    createNode: {
      enabledFromNodeType: 'channel_mixer',
      implementationVersion: 1,
      process: 'scene_referred_v2',
    },
    defaults: EDIT_DOCUMENT_SELECTIVE_COLOR_MIXER_DEFAULTS,
    fields: EDIT_DOCUMENT_SELECTIVE_COLOR_MIXER_FIELDS,
    nodeType: 'selective_color_mixer',
    schemas: editDocumentSelectiveColorMixerV2Schema.shape,
  });
  document = normalizeLegacyNodeOwnership(document, {
    defaults: EDIT_DOCUMENT_PERSPECTIVE_CORRECTION_DEFAULTS,
    fields: EDIT_DOCUMENT_PERSPECTIVE_CORRECTION_FIELDS,
    nodeType: 'geometry',
    schemas: editDocumentPerspectiveCorrectionV2Schema.shape,
  });
  const migratedNodes = document['nodes'];
  const migratedGeometry = document['geometry'];
  const migratedGeometryNode = isEditDocumentRecord(migratedNodes) ? migratedNodes['geometry'] : undefined;
  const migratedGeometryParams = isEditDocumentRecord(migratedGeometryNode)
    ? migratedGeometryNode['params']
    : undefined;
  if (isEditDocumentRecord(migratedGeometry) && isEditDocumentRecord(migratedGeometryParams)) {
    document = {
      ...document,
      geometry: {
        ...migratedGeometry,
        perspectiveCorrection: migratedGeometryParams['perspectiveCorrection'],
      },
    };
  }
  return document;
}, editDocumentV2ObjectSchema);

export type EditDocumentNodeTypeV2 = z.infer<typeof editDocumentNodeTypeV2Schema>;
export type EditDocumentNodeEnvelopeV2 = z.infer<typeof editDocumentNodeEnvelopeV2Schema>;
export type EditDocumentV2CopyPayload = z.infer<typeof editDocumentV2CopyPayloadSchema>;
export type EditDocumentV2 = z.infer<typeof editDocumentV2Schema>;
export type EditDocumentMigrationReceiptV2 = z.infer<typeof editDocumentMigrationReceiptV2Schema>;
export type EditDocumentCameraInputV2 = z.infer<typeof editDocumentCameraInputV2Schema>;
export type EditDocumentDetailDenoiseDehazeV2 = z.infer<typeof editDocumentDetailDenoiseDehazeV2Schema>;
export type EditDocumentDisplayCreativeV2 = z.infer<typeof editDocumentDisplayCreativeV2Schema>;
export type EditDocumentToneEqualizerV2 = z.infer<typeof editDocumentToneEqualizerV2Schema>;
export type EditDocumentPointColorV2 = z.infer<typeof editDocumentPointColorV2Schema>;
export type EditDocumentBlackWhiteMixerV2 = z.infer<typeof editDocumentBlackWhiteMixerV2Schema>;
export type EditDocumentChannelMixerV2 = z.infer<typeof editDocumentChannelMixerV2Schema>;
export type EditDocumentColorBalanceRgbV2 = z.infer<typeof editDocumentColorBalanceRgbV2Schema>;
export type EditDocumentLumaLevelsV2 = z.infer<typeof editDocumentLumaLevelsV2Schema>;
export type EditDocumentSelectiveColorMixerV2 = z.infer<typeof editDocumentSelectiveColorMixerV2Schema>;
export type EditDocumentPerceptualGradingV2 = z.infer<typeof editDocumentPerceptualGradingV2Schema>;
export type EditDocumentColorCalibrationV2 = z.infer<typeof editDocumentColorCalibrationV2Schema>;
export type EditDocumentSceneCurveV2 = z.infer<typeof editDocumentSceneCurveV2Schema>;
export type EditDocumentGeometryV2 = z.infer<typeof editDocumentGeometryV2Schema>;
export type EditDocumentLensCorrectionV2 = z.infer<typeof editDocumentLensCorrectionV2Schema>;
export type SceneGlobalColorToneParamsV2 = z.infer<typeof sceneGlobalColorToneParamsV2Schema>;

export interface CompiledEditDocumentNodeV2 {
  readonly enabled: boolean;
  readonly implementationVersion: number;
  readonly nodeType: EditDocumentNodeTypeV2;
  readonly params: Readonly<Record<string, unknown>>;
  readonly process: 'legacy_pipeline_v1' | 'scene_referred_v2';
  readonly renderStage: string;
}

/** Compile one validated envelope with descriptor-owned process and render-stage metadata. */
export const compileEditDocumentNodeV2 = (node: unknown): CompiledEditDocumentNodeV2 => {
  const envelope = editDocumentNodeEnvelopeV2Schema.parse(node);
  const descriptor = getEditDocumentNodeDescriptor(envelope.type);
  if (descriptor === undefined) throw new Error(`Unknown edit document node type: ${envelope.type}`);
  if (envelope.process !== descriptor.process) throw new Error(`Node '${envelope.type}' has an incompatible process.`);
  if (envelope.implementationVersion !== descriptor.implementationVersion) {
    throw new Error(`Node '${envelope.type}' has an unsupported version.`);
  }
  if (envelope.type === 'scene_global_color_tone') sceneGlobalColorToneParamsV2Schema.parse(envelope.params);
  if (envelope.type === 'scene_curve') editDocumentSceneCurveV2Schema.parse(envelope.params);
  if (envelope.type === 'detail_denoise_dehaze') editDocumentDetailDenoiseDehazeV2Schema.parse(envelope.params);
  if (envelope.type === 'display_creative') editDocumentDisplayCreativeV2Schema.parse(envelope.params);
  if (envelope.type === 'tone_equalizer') editDocumentToneEqualizerV2Schema.parse(envelope.params);
  if (envelope.type === 'point_color') editDocumentPointColorV2Schema.parse(envelope.params);
  if (envelope.type === 'black_white_mixer') editDocumentBlackWhiteMixerV2Schema.parse(envelope.params);
  if (envelope.type === 'channel_mixer') editDocumentChannelMixerV2Schema.parse(envelope.params);
  if (envelope.type === 'color_balance_rgb') editDocumentColorBalanceRgbV2Schema.parse(envelope.params);
  if (envelope.type === 'luma_levels') editDocumentLumaLevelsV2Schema.parse(envelope.params);
  if (envelope.type === 'selective_color_mixer') editDocumentSelectiveColorMixerV2Schema.parse(envelope.params);
  if (envelope.type === 'perceptual_grading') editDocumentPerceptualGradingV2Schema.parse(envelope.params);
  if (envelope.type === 'color_calibration') editDocumentColorCalibrationV2Schema.parse(envelope.params);
  if (envelope.type === 'camera_input') editDocumentCameraInputV2Schema.parse(envelope.params);
  if (envelope.type === 'geometry') editDocumentGeometryV2Schema.parse(envelope.params);
  if (envelope.type === 'lens_correction') editDocumentLensCorrectionV2Schema.parse(envelope.params);
  if (envelope.type === 'source_artifacts') editDocumentSourceArtifactsV2Schema.parse(envelope.params);
  if (envelope.type === 'layers') editDocumentLayersV2Schema.parse(envelope.params);
  return {
    enabled: envelope.enabled,
    implementationVersion: envelope.implementationVersion,
    nodeType: envelope.type,
    params: envelope.params,
    process: envelope.process,
    renderStage: descriptor.renderStage,
  };
};

/** Compile the complete graph in descriptor order so render stages have stable authority. */
export const compileEditDocumentV2 = (document: EditDocumentV2): readonly CompiledEditDocumentNodeV2[] => {
  const parsed = editDocumentV2Schema.parse(document);
  return EDIT_DOCUMENT_NODE_DESCRIPTORS.flatMap(({ nodeType }) => {
    const node = parsed.nodes[nodeType];
    return node === undefined ? [] : [compileEditDocumentNodeV2(node)];
  });
};

export const parseEditDocumentV2 = (value: unknown): EditDocumentV2 => editDocumentV2Schema.parse(value);

const editDocumentV2QuarantineInputSchema = z
  .object({
    extensions: z.record(z.string(), z.unknown()),
    geometry: editDocumentGeometryV2Schema,
    graphProcess: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
    layers: z.record(z.string(), z.unknown()),
    migration: editDocumentMigrationReceiptV2Schema.optional(),
    nodes: z.record(z.string(), z.unknown()),
    provenance: z.record(z.string(), z.unknown()),
    schemaVersion: z.literal(EDIT_DOCUMENT_V2_SCHEMA_VERSION),
    sourceArtifacts: z.record(z.string(), z.unknown()),
  })
  .strict();

export const parseEditDocumentV2WithQuarantine = (
  value: unknown,
): { document: EditDocumentV2; quarantinedNodeTypes: readonly string[] } => {
  const raw = editDocumentV2QuarantineInputSchema.parse(value);
  const knownTypes: ReadonlySet<string> = new Set(EDIT_DOCUMENT_NODE_DESCRIPTORS.map(({ nodeType }) => nodeType));
  const knownNodes = Object.fromEntries(Object.entries(raw.nodes).filter(([nodeType]) => knownTypes.has(nodeType)));
  const quarantinedNodes = Object.fromEntries(
    Object.entries(raw.nodes).filter(([nodeType]) => !knownTypes.has(nodeType)),
  );
  // biome-ignore lint/complexity/useLiteralKeys: extensions intentionally carries quarantined future nodes.
  const existingQuarantine = raw.extensions['quarantinedNodes'];
  const extensions = {
    ...raw.extensions,
    ...(Object.keys(quarantinedNodes).length > 0
      ? {
          quarantinedNodes: {
            ...(existingQuarantine && typeof existingQuarantine === 'object' ? existingQuarantine : {}),
            ...quarantinedNodes,
          },
        }
      : {}),
  };
  const migration = raw.migration
    ? {
        ...raw.migration,
        quarantined: [...new Set([...raw.migration.quarantined, ...Object.keys(quarantinedNodes)])].sort(),
      }
    : undefined;
  const document = editDocumentV2Schema.parse({ ...raw, extensions, migration, nodes: knownNodes });
  return { document, quarantinedNodeTypes: Object.keys(quarantinedNodes).sort() };
};

export const getEditDocumentNodeDescriptor = (nodeType: EditDocumentNodeTypeV2) =>
  EDIT_DOCUMENT_NODE_DESCRIPTORS.find((descriptor) => descriptor.nodeType === nodeType);

export type EditDocumentEditorSection = NonNullable<(typeof EDIT_DOCUMENT_NODE_DESCRIPTORS)[number]['editorSection']>;

export const getEditDocumentNodeTypesForEditorSection = (
  section: EditDocumentEditorSection,
): readonly EditDocumentNodeTypeV2[] =>
  EDIT_DOCUMENT_NODE_DESCRIPTORS.filter((descriptor) => descriptor.editorSection === section).map(
    ({ nodeType }) => nodeType,
  );

const hasFiniteJsonValues = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasFiniteJsonValues);
  if (value !== null && typeof value === 'object') return Object.values(value).every(hasFiniteJsonValues);
  return true;
};
