import { z } from 'zod';
import {
  ActorKind,
  ApprovalClass,
  type EditGraphCommandEnvelopeV1,
  type EditGraphMutationResultV1,
  type EditGraphParameterPatchOperationV1,
  editGraphCommandEnvelopeV1Schema,
  editGraphDryRunResultV1Schema,
  editGraphMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import type { Adjustments } from '../../adjustments';
import { pushEditHistoryEntry } from '../../editHistory';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import { createLiveEditorAppServerBridge } from '../session/agentLiveEditorCoreState';

export const AGENT_GEOMETRY_APPLY_TOOL_NAME = 'rawengine.agent.geometry.apply';
export const AGENT_GEOMETRY_APPLY_INPUT_SCHEMA_NAME = 'AgentGeometryApplyRequestV1';
export const AGENT_GEOMETRY_APPLY_OUTPUT_SCHEMA_NAME = 'AgentGeometryApplyResponseV1';

const cropSchema = z
  .object({
    height: z.number().positive().max(100),
    unit: z.literal('%'),
    width: z.number().positive().max(100),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  })
  .strict()
  .refine((crop) => crop.x + crop.width <= 100, {
    message: 'Crop x + width must stay within percentage image bounds.',
    path: ['width'],
  })
  .refine((crop) => crop.y + crop.height <= 100, {
    message: 'Crop y + height must stay within percentage image bounds.',
    path: ['height'],
  });

const geometryPatchSchema = z
  .object({
    aspectRatio: z.number().positive().max(10).nullable().optional(),
    crop: cropSchema.nullable().optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
    orientationSteps: z.number().int().min(0).max(3).optional(),
    rotation: z.number().min(-45).max(45).optional(),
    transformAspect: z.number().min(-100).max(100).optional(),
    transformDistortion: z.number().min(-100).max(100).optional(),
    transformHorizontal: z.number().min(-100).max(100).optional(),
    transformRotate: z.number().min(-45).max(45).optional(),
    transformScale: z.number().min(0.1).max(5).optional(),
    transformVertical: z.number().min(-100).max(100).optional(),
    transformXOffset: z.number().min(-100).max(100).optional(),
    transformYOffset: z.number().min(-100).max(100).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'At least one geometry adjustment is required.' });

export const agentGeometryApplyRequestSchema = z
  .object({
    expectedRecipeHash: z.string().trim().min(1),
    geometry: geometryPatchSchema,
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentGeometryApplyResponseSchema = z
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
    toolName: z.literal(AGENT_GEOMETRY_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentGeometryApplyRequest = z.infer<typeof agentGeometryApplyRequestSchema>;
export type AgentGeometryApplyResponse = z.infer<typeof agentGeometryApplyResponseSchema>;

const GEOMETRY_KEYS = [
  'aspectRatio',
  'crop',
  'flipHorizontal',
  'flipVertical',
  'orientationSteps',
  'rotation',
  'transformAspect',
  'transformDistortion',
  'transformHorizontal',
  'transformRotate',
  'transformScale',
  'transformVertical',
  'transformXOffset',
  'transformYOffset',
] as const satisfies ReadonlyArray<keyof z.infer<typeof geometryPatchSchema>>;

const applyGeometryPatchToAdjustments = (
  base: Adjustments,
  patch: z.infer<typeof geometryPatchSchema>,
): Adjustments => {
  const next: Adjustments = { ...base };
  if (patch.aspectRatio !== undefined) next.aspectRatio = patch.aspectRatio;
  if (patch.crop !== undefined) next.crop = patch.crop;
  if (patch.flipHorizontal !== undefined) next.flipHorizontal = patch.flipHorizontal;
  if (patch.flipVertical !== undefined) next.flipVertical = patch.flipVertical;
  if (patch.orientationSteps !== undefined) next.orientationSteps = patch.orientationSteps;
  if (patch.rotation !== undefined) next.rotation = patch.rotation;
  if (patch.transformAspect !== undefined) next.transformAspect = patch.transformAspect;
  if (patch.transformDistortion !== undefined) next.transformDistortion = patch.transformDistortion;
  if (patch.transformHorizontal !== undefined) next.transformHorizontal = patch.transformHorizontal;
  if (patch.transformRotate !== undefined) next.transformRotate = patch.transformRotate;
  if (patch.transformScale !== undefined) next.transformScale = patch.transformScale;
  if (patch.transformVertical !== undefined) next.transformVertical = patch.transformVertical;
  if (patch.transformXOffset !== undefined) next.transformXOffset = patch.transformXOffset;
  if (patch.transformYOffset !== undefined) next.transformYOffset = patch.transformYOffset;
  return next;
};

const estimateGeometryPixelChange = ({
  after,
  before,
  imageArea,
}: {
  after: Adjustments;
  before: Adjustments;
  imageArea: number;
}): number => {
  const changedFieldCount = GEOMETRY_KEYS.filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  ).length;
  return Math.max(1, Math.round((imageArea / 256) * Math.max(1, changedFieldCount)));
};

const buildGeometryPatchOperations = (
  before: Adjustments,
  patch: z.infer<typeof geometryPatchSchema>,
): EditGraphParameterPatchOperationV1[] =>
  GEOMETRY_KEYS.flatMap((key) => {
    if (patch[key] === undefined) return [];
    return [
      {
        nodeId: 'geometry',
        op: before[key] === undefined ? 'add' : 'replace',
        path: `/adjustments/${key}`,
        previousValue: before[key],
        value: patch[key],
      },
    ];
  });

const buildAgentGeometryEditGraphCommand = ({
  commandId,
  dryRun,
  expectedGraphRevision,
  imagePath,
  operations,
  request,
}: {
  commandId: string;
  dryRun: boolean;
  expectedGraphRevision: string;
  imagePath: string;
  operations: EditGraphParameterPatchOperationV1[];
  request: AgentGeometryApplyRequest;
}): EditGraphCommandEnvelopeV1 =>
  editGraphCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'rawengine-agent',
      kind: ActorKind.Agent,
      sessionId: request.sessionId,
    },
    approval: dryRun
      ? {
          approvalClass: ApprovalClass.PreviewOnly,
          reason: 'Preview agent geometry patch through typed edit graph dispatch.',
          state: 'not_required',
        }
      : {
          approvalClass: ApprovalClass.EditApply,
          reason: 'Apply agent geometry patch after typed edit graph dry-run.',
          state: 'approved',
        },
    commandId,
    commandType: 'editGraph.applyParameterPatch',
    correlationId: `corr_${request.operationId}`,
    dryRun,
    expectedGraphRevision,
    idempotencyKey: `${request.operationId}:editGraph.applyParameterPatch:${dryRun ? 'dry_run' : 'apply'}`,
    parameters: {
      label: 'Agent geometry adjustment',
      operations,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath,
      kind: 'image',
    },
  });

const dispatchTypedGeometryEditGraphApply = async ({
  expectedGraphRevision,
  imagePath,
  operations,
  request,
}: {
  expectedGraphRevision: string;
  imagePath: string;
  operations: EditGraphParameterPatchOperationV1[];
  request: AgentGeometryApplyRequest;
}): Promise<EditGraphMutationResultV1> => {
  const bridge = createLiveEditorAppServerBridge();
  const dryRunCommand = buildAgentGeometryEditGraphCommand({
    commandId: `${request.operationId}_dry_run`,
    dryRun: true,
    expectedGraphRevision,
    imagePath,
    operations,
    request,
  });
  const dryRun = await bridge.dispatch(dryRunCommand, { requestId: request.requestId, now: () => new Date() });
  if (!dryRun.ok) throw new Error(`Agent geometry typed dry-run failed: ${dryRun.message}`);
  const dryRunResult = editGraphDryRunResultV1Schema.parse(dryRun.result);
  if (dryRunResult.sourceGraphRevision !== expectedGraphRevision) {
    throw new Error('Agent geometry typed dry-run receipt did not match the editor graph revision.');
  }

  const applyCommand = buildAgentGeometryEditGraphCommand({
    commandId: `${request.operationId}_apply`,
    dryRun: false,
    expectedGraphRevision,
    imagePath,
    operations,
    request,
  });
  const apply = await bridge.dispatch(applyCommand, { requestId: request.requestId, now: () => new Date() });
  if (!apply.ok) throw new Error(`Agent geometry typed apply failed: ${apply.message}`);
  return editGraphMutationResultV1Schema.parse(apply.result);
};

export const applyAgentGeometry = async (request: AgentGeometryApplyRequest): Promise<AgentGeometryApplyResponse> => {
  const parsedRequest = agentGeometryApplyRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  if (parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent geometry apply rejected stale recipe hash.');
  }

  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent geometry apply requires a selected image.');

  const beforeAdjustments = state.adjustments;
  const undoGraphRevision = `history_${state.historyIndex}`;
  const operations = buildGeometryPatchOperations(beforeAdjustments, parsedRequest.geometry);
  const typedMutation = await dispatchTypedGeometryEditGraphApply({
    expectedGraphRevision: undoGraphRevision,
    imagePath: selectedImage.path,
    operations,
    request: parsedRequest,
  });
  const nextAdjustments = applyGeometryPatchToAdjustments(beforeAdjustments, parsedRequest.geometry);
  const history = pushEditHistoryEntry(state.history, state.historyIndex, nextAdjustments);
  useEditorStore.setState({
    adjustments: nextAdjustments,
    history: history.history,
    historyIndex: history.historyIndex,
    uncroppedAdjustedPreviewUrl: null,
  });

  const afterSnapshot = buildAgentImageContextSnapshot();
  const adjustedFields = GEOMETRY_KEYS.filter((key) => parsedRequest.geometry[key] !== undefined);
  const appliedGraphRevision = `history_${useEditorStore.getState().historyIndex}`;

  return agentGeometryApplyResponseSchema.parse({
    adjustedFields,
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision,
    beforePreviewHash: snapshot.initialPreview.renderHash,
    changedPixelCount: estimateGeometryPixelChange({
      after: nextAdjustments,
      before: beforeAdjustments,
      imageArea: selectedImage.width * selectedImage.height,
    }),
    receipt: {
      adjustedFields,
      appliedGraphRevision: typedMutation.appliedGraphRevision,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
      undoGraphRevision,
    },
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_GEOMETRY_APPLY_TOOL_NAME,
    undoGraphRevision,
  });
};
