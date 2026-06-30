import { z } from 'zod';
import { blackWhiteMixerSettingsSchema } from '../../../schemas/color/blackWhiteMixerSchemas';
import { channelMixerSettingsSchema } from '../../../schemas/color/channelMixerSchemas';
import { colorBalanceRgbSettingsSchema } from '../../../schemas/color/colorBalanceRgbSchemas';
import { cameraProfileIdSchema, toneCurveIdSchema } from '../../../schemas/color/profileToneSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import type { Adjustments } from '../../adjustments';
import { getDefaultParametricCurve } from '../../adjustments';
import { buildAgentImageContextSnapshot } from '../../agentImageContextSnapshot';
import { pushEditHistoryEntry } from '../../editHistory';
import { TONE_CURVE_PARAMETRIC_PRESETS } from '../../profileTonePresets';

export const AGENT_COLOR_APPLY_TOOL_NAME = 'rawengine.agent.color.apply';
export const AGENT_COLOR_APPLY_INPUT_SCHEMA_NAME = 'AgentColorApplyRequestV1';
export const AGENT_COLOR_APPLY_OUTPUT_SCHEMA_NAME = 'AgentColorApplyResponseV1';

const selectiveColorRangeKeySchema = z.enum([
  'reds',
  'oranges',
  'yellows',
  'greens',
  'aquas',
  'blues',
  'purples',
  'magentas',
]);
const hueSatLumSchema = z
  .object({
    hue: z.number().min(-180).max(180),
    luminance: z.number().min(-100).max(100),
    saturation: z.number().min(-100).max(100),
  })
  .strict();
const hslPatchSchema = z
  .object({
    aquas: hueSatLumSchema.optional(),
    blues: hueSatLumSchema.optional(),
    greens: hueSatLumSchema.optional(),
    magentas: hueSatLumSchema.optional(),
    oranges: hueSatLumSchema.optional(),
    purples: hueSatLumSchema.optional(),
    reds: hueSatLumSchema.optional(),
    yellows: hueSatLumSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'At least one HSL range is required.',
  });
const rangeControlSchema = z
  .object({
    centerHueDegrees: z.number().min(0).max(360),
    falloffSmoothness: z.number().min(0.25).max(4),
    widthDegrees: z.number().min(10).max(180),
  })
  .strict();
const selectiveRangeControlsPatchSchema = z
  .object({
    aquas: rangeControlSchema.optional(),
    blues: rangeControlSchema.optional(),
    greens: rangeControlSchema.optional(),
    magentas: rangeControlSchema.optional(),
    oranges: rangeControlSchema.optional(),
    purples: rangeControlSchema.optional(),
    reds: rangeControlSchema.optional(),
    yellows: rangeControlSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'At least one selective color range control is required.',
  });
const colorGradingWheelSchema = z
  .object({
    hue: z.number().min(0).max(360),
    luminance: z.number().min(-100).max(100),
    saturation: z.number().min(0).max(100),
  })
  .strict();
const colorGradingSchema = z
  .object({
    balance: z.number().min(-100).max(100),
    blending: z.number().min(0).max(100),
    global: colorGradingWheelSchema,
    highlights: colorGradingWheelSchema,
    midtones: colorGradingWheelSchema,
    shadows: colorGradingWheelSchema,
  })
  .strict();
const colorCalibrationSchema = z
  .object({
    blueHue: z.number().min(-100).max(100),
    blueSaturation: z.number().min(-100).max(100),
    greenHue: z.number().min(-100).max(100),
    greenSaturation: z.number().min(-100).max(100),
    redHue: z.number().min(-100).max(100),
    redSaturation: z.number().min(-100).max(100),
    shadowsTint: z.number().min(-100).max(100),
  })
  .strict();
const skinToneUniformitySchema = z
  .object({
    enabled: z.boolean(),
    hueUniformity: z.number().min(0).max(0.75),
    luminanceUniformity: z.number().min(0).max(0.75),
    maxHueShiftDegrees: z.number().min(0).max(30),
    saturationUniformity: z.number().min(0).max(0.75),
    targetHueDegrees: z.number().min(0).lt(360),
    targetLuminance: z.number().min(0).max(1),
    targetSaturation: z.number().min(0).max(1),
  })
  .strict();
const agentColorPatchSchema = z
  .object({
    blackWhiteMixer: blackWhiteMixerSettingsSchema.optional(),
    cameraProfile: cameraProfileIdSchema.optional(),
    channelMixer: channelMixerSettingsSchema.optional(),
    colorBalanceRgb: colorBalanceRgbSettingsSchema.optional(),
    colorCalibration: colorCalibrationSchema.optional(),
    colorGrading: colorGradingSchema.optional(),
    hsl: hslPatchSchema.optional(),
    saturation: z.number().min(-100).max(100).optional(),
    selectiveColorRangeControls: selectiveRangeControlsPatchSchema.optional(),
    skinToneUniformity: skinToneUniformitySchema.optional(),
    temperature: z.number().min(-100).max(100).optional(),
    tint: z.number().min(-100).max(100).optional(),
    toneCurve: toneCurveIdSchema.optional(),
    vibrance: z.number().min(-100).max(100).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'At least one color adjustment is required.' });

export const agentColorApplyRequestSchema = z
  .object({
    color: agentColorPatchSchema,
    expectedRecipeHash: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentColorApplyResponseSchema = z
  .object({
    adjustedFields: z.array(z.string().trim().min(1)).min(1),
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    changedPixelCount: z.number().int().positive(),
    receipt: z
      .object({
        adjustedFields: z.array(z.string().trim().min(1)).min(1),
        appliedGraphRevision: z.string().trim().min(1),
        operationId: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
        undoGraphRevision: z.string().trim().min(1),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_COLOR_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentColorApplyRequest = z.infer<typeof agentColorApplyRequestSchema>;
export type AgentColorApplyResponse = z.infer<typeof agentColorApplyResponseSchema>;
type AgentColorPatch = z.infer<typeof agentColorPatchSchema>;

const SELECTIVE_COLOR_RANGE_KEYS = selectiveColorRangeKeySchema.options;
const COLOR_PATCH_KEYS = [
  'blackWhiteMixer',
  'cameraProfile',
  'channelMixer',
  'colorBalanceRgb',
  'colorCalibration',
  'colorGrading',
  'hsl',
  'saturation',
  'selectiveColorRangeControls',
  'skinToneUniformity',
  'temperature',
  'tint',
  'toneCurve',
  'vibrance',
] as const satisfies ReadonlyArray<keyof AgentColorPatch>;

const applyColorPatchToAdjustments = (base: Adjustments, patch: AgentColorPatch): Adjustments => {
  const next: Adjustments = { ...base };
  if (patch.temperature !== undefined) next.temperature = patch.temperature;
  if (patch.tint !== undefined) next.tint = patch.tint;
  if (patch.vibrance !== undefined) next.vibrance = patch.vibrance;
  if (patch.saturation !== undefined) next.saturation = patch.saturation;
  if (patch.cameraProfile !== undefined) next.cameraProfile = patch.cameraProfile;
  if (patch.toneCurve !== undefined) {
    const parametricCurve = base.parametricCurve ?? getDefaultParametricCurve();
    next.toneCurve = patch.toneCurve;
    next.curveMode = 'parametric';
    next.parametricCurve = {
      ...parametricCurve,
      luma: { ...TONE_CURVE_PARAMETRIC_PRESETS[patch.toneCurve] },
    };
  }
  if (patch.blackWhiteMixer !== undefined) next.blackWhiteMixer = { ...patch.blackWhiteMixer };
  if (patch.colorBalanceRgb !== undefined) {
    next.colorBalanceRgb = {
      enabled: patch.colorBalanceRgb.enabled,
      highlights: { ...patch.colorBalanceRgb.highlights },
      midtones: { ...patch.colorBalanceRgb.midtones },
      preserveLuminance: patch.colorBalanceRgb.preserveLuminance,
      shadows: { ...patch.colorBalanceRgb.shadows },
    };
  }
  if (patch.channelMixer !== undefined) {
    next.channelMixer = {
      blue: { ...patch.channelMixer.blue },
      enabled: patch.channelMixer.enabled,
      green: { ...patch.channelMixer.green },
      preserveLuminance: patch.channelMixer.preserveLuminance,
      red: { ...patch.channelMixer.red },
    };
  }
  if (patch.colorCalibration !== undefined) next.colorCalibration = { ...patch.colorCalibration };
  if (patch.colorGrading !== undefined) {
    next.colorGrading = {
      balance: patch.colorGrading.balance,
      blending: patch.colorGrading.blending,
      global: { ...patch.colorGrading.global },
      highlights: { ...patch.colorGrading.highlights },
      midtones: { ...patch.colorGrading.midtones },
      shadows: { ...patch.colorGrading.shadows },
    };
  }
  if (patch.skinToneUniformity !== undefined) next.skinToneUniformity = { ...patch.skinToneUniformity };
  if (patch.hsl !== undefined) {
    next.hsl = { ...base.hsl };
    for (const rangeKey of SELECTIVE_COLOR_RANGE_KEYS) {
      const adjustment = patch.hsl[rangeKey];
      if (adjustment !== undefined) next.hsl[rangeKey] = { ...adjustment };
    }
  }
  if (patch.selectiveColorRangeControls !== undefined) {
    next.selectiveColorRangeControls = { ...base.selectiveColorRangeControls };
    for (const rangeKey of SELECTIVE_COLOR_RANGE_KEYS) {
      const rangeControl = patch.selectiveColorRangeControls[rangeKey];
      if (rangeControl !== undefined) next.selectiveColorRangeControls[rangeKey] = { ...rangeControl };
    }
  }
  return next;
};

const estimateChangedPixels = ({
  after,
  before,
  imageArea,
}: {
  after: Adjustments;
  before: Adjustments;
  imageArea: number;
}) => {
  const changedFieldCount = COLOR_PATCH_KEYS.filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  ).length;
  return Math.max(1, Math.round((imageArea / 384) * Math.max(1, changedFieldCount)));
};

export const applyAgentColor = (request: AgentColorApplyRequest): AgentColorApplyResponse => {
  const parsedRequest = agentColorApplyRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  if (parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent color apply rejected stale recipe hash.');
  }

  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent color apply requires a selected image.');

  const undoGraphRevision = `history_${state.historyIndex}`;
  const nextAdjustments = applyColorPatchToAdjustments(state.adjustments, parsedRequest.color);
  const history = pushEditHistoryEntry(state.history, state.historyIndex, nextAdjustments);
  useEditorStore.setState({
    adjustments: nextAdjustments,
    history: history.history,
    historyIndex: history.historyIndex,
    uncroppedAdjustedPreviewUrl: null,
  });

  const afterSnapshot = buildAgentImageContextSnapshot();
  const adjustedFields = COLOR_PATCH_KEYS.filter((key) => parsedRequest.color[key] !== undefined);
  const appliedGraphRevision = `history_${useEditorStore.getState().historyIndex}`;

  return agentColorApplyResponseSchema.parse({
    adjustedFields,
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision,
    beforePreviewHash: snapshot.initialPreview.renderHash,
    changedPixelCount: estimateChangedPixels({
      after: nextAdjustments,
      before: state.adjustments,
      imageArea: selectedImage.width * selectedImage.height,
    }),
    receipt: {
      adjustedFields,
      appliedGraphRevision,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
      undoGraphRevision,
    },
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_COLOR_APPLY_TOOL_NAME,
    undoGraphRevision,
  });
};
