import { z } from 'zod';
import { levelsSettingsSchema } from '../../../schemas/levelsSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import type { Adjustments, Coord, Curves, ParametricCurve, ParametricCurveSettings } from '../../adjustments';
import { ActiveChannel, getDefaultParametricCurve } from '../../adjustments';
import { buildAgentImageContextSnapshot } from '../../agentImageContextSnapshot';
import { pushEditHistoryEntry } from '../../editHistory';

export const AGENT_CURVE_LEVELS_APPLY_TOOL_NAME = 'rawengine.agent.curve_levels.apply';
export const AGENT_CURVE_LEVELS_APPLY_INPUT_SCHEMA_NAME = 'AgentCurveLevelsApplyRequestV1';
export const AGENT_CURVE_LEVELS_APPLY_OUTPUT_SCHEMA_NAME = 'AgentCurveLevelsApplyResponseV1';

const toneCurveIdSchema = z.enum(['auto_filmic', 'linear', 'soft_contrast', 'high_contrast', 'shadow_lift']);
const curvePointSchema = z.object({ x: z.number().min(0).max(255), y: z.number().min(0).max(255) }).strict();
const pointCurveSchema = z
  .array(curvePointSchema)
  .min(2)
  .max(16)
  .superRefine((points, context) => {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (previous !== undefined && current !== undefined && current.x <= previous.x) {
        context.addIssue({
          code: 'custom',
          message: 'Curve points must have strictly increasing x values.',
          path: [index, 'x'],
        });
      }
    }
  });
const pointCurvesPatchSchema = z
  .object({
    [ActiveChannel.Blue]: pointCurveSchema.optional(),
    [ActiveChannel.Green]: pointCurveSchema.optional(),
    [ActiveChannel.Luma]: pointCurveSchema.optional(),
    [ActiveChannel.Red]: pointCurveSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'At least one point curve channel is required.',
  });
const parametricSettingsSchema = z
  .object({
    blackLevel: z.number().min(-100).max(100),
    darks: z.number().min(-100).max(100),
    highlights: z.number().min(-100).max(100),
    lights: z.number().min(-100).max(100),
    shadows: z.number().min(-100).max(100),
    split1: z.number().min(0).max(100),
    split2: z.number().min(0).max(100),
    split3: z.number().min(0).max(100),
    whiteLevel: z.number().min(-100).max(100),
  })
  .strict()
  .superRefine((settings, context) => {
    if (!(settings.split1 < settings.split2 && settings.split2 < settings.split3)) {
      context.addIssue({ code: 'custom', message: 'Parametric curve split points must be ordered.' });
    }
  });
const parametricCurvePatchSchema = z
  .object({
    [ActiveChannel.Blue]: parametricSettingsSchema.optional(),
    [ActiveChannel.Green]: parametricSettingsSchema.optional(),
    [ActiveChannel.Luma]: parametricSettingsSchema.optional(),
    [ActiveChannel.Red]: parametricSettingsSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'At least one parametric curve channel is required.',
  });
const curveLevelsPatchSchema = z
  .object({
    curveMode: z.enum(['point', 'parametric']).optional(),
    levels: levelsSettingsSchema.optional(),
    parametricCurve: parametricCurvePatchSchema.optional(),
    pointCurves: pointCurvesPatchSchema.optional(),
    toneCurve: toneCurveIdSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'At least one curve/levels adjustment is required.' });

export const agentCurveLevelsApplyRequestSchema = z
  .object({
    curveLevels: curveLevelsPatchSchema,
    expectedRecipeHash: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentCurveLevelsApplyResponseSchema = z
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
    toolName: z.literal(AGENT_CURVE_LEVELS_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentCurveLevelsApplyRequest = z.infer<typeof agentCurveLevelsApplyRequestSchema>;
export type AgentCurveLevelsApplyResponse = z.infer<typeof agentCurveLevelsApplyResponseSchema>;
type CurveLevelsPatch = z.infer<typeof curveLevelsPatchSchema>;

const CHANNELS = [ActiveChannel.Luma, ActiveChannel.Red, ActiveChannel.Green, ActiveChannel.Blue] as const;
const CURVE_LEVELS_KEYS = ['curveMode', 'levels', 'parametricCurve', 'pointCurves', 'toneCurve'] as const;

const clonePoints = (points: readonly Coord[]): Coord[] => points.map((point) => ({ x: point.x, y: point.y }));
const cloneCurves = (curves: Curves): Curves => ({
  blue: clonePoints(curves.blue),
  green: clonePoints(curves.green),
  luma: clonePoints(curves.luma),
  red: clonePoints(curves.red),
});
const cloneParametricSettings = (settings: ParametricCurveSettings): ParametricCurveSettings => ({ ...settings });
const cloneParametricCurve = (curve: ParametricCurve): ParametricCurve => ({
  blue: cloneParametricSettings(curve.blue),
  green: cloneParametricSettings(curve.green),
  luma: cloneParametricSettings(curve.luma),
  red: cloneParametricSettings(curve.red),
});

const applyCurveLevelsPatchToAdjustments = (base: Adjustments, patch: CurveLevelsPatch): Adjustments => {
  const next: Adjustments = { ...base };

  if (patch.curveMode !== undefined) next.curveMode = patch.curveMode;
  if (patch.levels !== undefined) next.levels = { ...patch.levels };
  if (patch.toneCurve !== undefined) next.toneCurve = patch.toneCurve;
  if (patch['pointCurves'] !== undefined) {
    const curves = cloneCurves(base.pointCurves ?? base.curves);
    for (const channel of CHANNELS) {
      const points = patch['pointCurves'][channel];
      if (points !== undefined) curves[channel] = clonePoints(points);
    }
    next.pointCurves = curves;
    next.curves = curves;
  }
  if (patch['parametricCurve'] !== undefined) {
    const parametric = cloneParametricCurve(base.parametricCurve ?? getDefaultParametricCurve());
    for (const channel of CHANNELS) {
      const settings = patch['parametricCurve'][channel];
      if (settings !== undefined) parametric[channel] = cloneParametricSettings(settings);
    }
    next.parametricCurve = parametric;
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
  const changedFieldCount = CURVE_LEVELS_KEYS.filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  ).length;
  return Math.max(1, Math.round((imageArea / 512) * Math.max(1, changedFieldCount)));
};

export const applyAgentCurveLevels = (request: AgentCurveLevelsApplyRequest): AgentCurveLevelsApplyResponse => {
  const parsedRequest = agentCurveLevelsApplyRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  if (parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent curve/levels apply rejected stale recipe hash.');
  }

  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent curve/levels apply requires a selected image.');

  const undoGraphRevision = `history_${state.historyIndex}`;
  const nextAdjustments = applyCurveLevelsPatchToAdjustments(state.adjustments, parsedRequest.curveLevels);
  const history = pushEditHistoryEntry(state.history, state.historyIndex, nextAdjustments);
  useEditorStore.setState({
    adjustments: nextAdjustments,
    history: history.history,
    historyIndex: history.historyIndex,
    uncroppedAdjustedPreviewUrl: null,
  });

  const afterSnapshot = buildAgentImageContextSnapshot();
  const adjustedFields = CURVE_LEVELS_KEYS.filter((key) => parsedRequest.curveLevels[key] !== undefined);
  const appliedGraphRevision = `history_${useEditorStore.getState().historyIndex}`;

  return agentCurveLevelsApplyResponseSchema.parse({
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
    toolName: AGENT_CURVE_LEVELS_APPLY_TOOL_NAME,
    undoGraphRevision,
  });
};
