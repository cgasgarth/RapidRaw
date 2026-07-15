import { z } from 'zod';
import { perceptualGradingSettingsV1Schema } from './color/perceptualGradingSchemas.js';
import { pointColorPlanV1Schema } from './color/pointColorSchemas.js';
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

export const editDocumentDetailDenoiseDehazeV2Schema = z
  .object({
    clarity: z.number().finite().min(-100).max(100),
    colorNoiseReduction: z.number().finite().min(0).max(100),
    dehaze: z.number().finite().min(-100).max(100),
    denoiseContrastProtection: z.number().finite().min(0).max(100),
    denoiseDetail: z.number().finite().min(0).max(100),
    denoiseNaturalGrain: z.number().finite().min(0).max(100),
    denoiseShadowBias: z.number().finite().min(-100).max(100),
    lumaNoiseReduction: z.number().finite().min(0).max(100),
    sharpness: z.number().finite().min(-100).max(100),
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

export const editDocumentGeometryV2Schema = z
  .object({
    aspectRatio: z.number().finite().positive().nullable(),
    crop: editDocumentGeometryCropV2Schema.nullable(),
    flipHorizontal: z.boolean(),
    flipVertical: z.boolean(),
    orientationSteps: z.number().int().min(0).max(3),
    rotation: z.number().finite().min(-45).max(45),
  })
  .strict();

export const EDIT_DOCUMENT_NODE_DESCRIPTORS = [
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
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
    legacyFields: ['blacks', 'brightness', 'contrast', 'exposure', 'highlights', 'saturation', 'shadows', 'whites'],
    nodeType: 'scene_global_color_tone',
    process: 'scene_referred_v2',
    renderStage: 'scene_global_color_tone',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
    defaultParams: {
      curveMode: 'point',
      curves: DEFAULT_EDIT_DOCUMENT_CURVES_V2,
      parametricCurve: DEFAULT_EDIT_DOCUMENT_PARAMETRIC_CURVES_V2,
      pointCurves: DEFAULT_EDIT_DOCUMENT_CURVES_V2,
      toneCurve: 'auto_filmic',
    },
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
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
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
    legacyFields: ['toneEqualizer'],
    nodeType: 'tone_equalizer',
    process: 'scene_referred_v2',
    renderStage: 'tone_equalizer',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
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
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
    defaultParams: {
      clarity: 0,
      colorNoiseReduction: 0,
      dehaze: 0,
      denoiseContrastProtection: 50,
      denoiseDetail: 50,
      denoiseNaturalGrain: 0,
      denoiseShadowBias: 0,
      lumaNoiseReduction: 0,
      sharpness: 0,
    },
    legacyFields: [
      'clarity',
      'colorNoiseReduction',
      'dehaze',
      'denoiseContrastProtection',
      'denoiseDetail',
      'denoiseNaturalGrain',
      'denoiseShadowBias',
      'lumaNoiseReduction',
      'sharpness',
    ],
    nodeType: 'detail_denoise_dehaze',
    process: 'scene_referred_v2',
    renderStage: 'detail_denoise_dehaze',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
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
    legacyFields: ['pointColor'],
    nodeType: 'point_color',
    process: 'scene_referred_v2',
    renderStage: 'point_color',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
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
    legacyFields: ['colorGrading', 'perceptualGradingV1'],
    nodeType: 'perceptual_grading',
    process: 'scene_referred_v2',
    renderStage: 'perceptual_grading',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
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
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
    defaultParams: {
      aspectRatio: null,
      crop: null,
      flipHorizontal: false,
      flipVertical: false,
      orientationSteps: 0,
      rotation: 0,
    },
    legacyFields: ['aspectRatio', 'crop', 'flipHorizontal', 'flipVertical', 'orientationSteps', 'rotation'],
    nodeType: 'geometry',
    process: 'legacy_pipeline_v1',
    renderStage: 'geometry',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: false, copy: false, paste: false, provenance: 'preserve', reset: false },
    defaultParams: { masks: [] },
    legacyFields: ['masks'],
    nodeType: 'layers',
    process: 'scene_referred_v2',
    renderStage: 'layers',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: false, copy: false, paste: false, provenance: 'regenerate', reset: false },
    defaultParams: { aiPatches: [] },
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
  provenance: z.enum(['preserve', 'regenerate', 'strip']),
  reset: z.boolean(),
});

export const editDocumentNodeDescriptorSchema = z.object({
  capabilities: editDocumentNodeCapabilitySchema,
  defaultParams: z.record(z.string(), z.unknown()),
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

export const editDocumentLayerV2Schema = z
  .object({
    adjustments: z.record(z.string(), editDocumentJsonValueSchema),
    blendMode: editDocumentLayerBlendModeV2Schema.optional(),
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
      if (nodeType === 'perceptual_grading') {
        const perceptualGrading = editDocumentPerceptualGradingV2Schema.safeParse(node.params);
        if (!perceptualGrading.success) {
          for (const issue of perceptualGrading.error.issues) {
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

export const editDocumentV2Schema = z
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

export type EditDocumentNodeTypeV2 = z.infer<typeof editDocumentNodeTypeV2Schema>;
export type EditDocumentNodeEnvelopeV2 = z.infer<typeof editDocumentNodeEnvelopeV2Schema>;
export type EditDocumentV2 = z.infer<typeof editDocumentV2Schema>;
export type EditDocumentMigrationReceiptV2 = z.infer<typeof editDocumentMigrationReceiptV2Schema>;
export type EditDocumentCameraInputV2 = z.infer<typeof editDocumentCameraInputV2Schema>;
export type EditDocumentDetailDenoiseDehazeV2 = z.infer<typeof editDocumentDetailDenoiseDehazeV2Schema>;
export type EditDocumentDisplayCreativeV2 = z.infer<typeof editDocumentDisplayCreativeV2Schema>;
export type EditDocumentToneEqualizerV2 = z.infer<typeof editDocumentToneEqualizerV2Schema>;
export type EditDocumentPointColorV2 = z.infer<typeof editDocumentPointColorV2Schema>;
export type EditDocumentPerceptualGradingV2 = z.infer<typeof editDocumentPerceptualGradingV2Schema>;
export type EditDocumentSceneCurveV2 = z.infer<typeof editDocumentSceneCurveV2Schema>;
export type EditDocumentGeometryV2 = z.infer<typeof editDocumentGeometryV2Schema>;
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
  if (envelope.type === 'perceptual_grading') editDocumentPerceptualGradingV2Schema.parse(envelope.params);
  if (envelope.type === 'camera_input') editDocumentCameraInputV2Schema.parse(envelope.params);
  if (envelope.type === 'geometry') editDocumentGeometryV2Schema.parse(envelope.params);
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

const hasFiniteJsonValues = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasFiniteJsonValues);
  if (value !== null && typeof value === 'object') return Object.values(value).every(hasFiniteJsonValues);
  return true;
};
