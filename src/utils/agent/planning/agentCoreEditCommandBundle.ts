import type { RawEngineLocalAppServerBridge } from '../../../../packages/rawengine-schema/src/localAppServerBridge';
import {
  type ToneColorDryRunResultV1,
  type ToneColorMutationResultV1,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import { buildAgentToolEditTransaction, captureAgentToolCommitIdentity } from '../../agentToolEditTransaction';
import {
  applyBasicToneCommandEnvelopeToAdjustments,
  type BasicToneAdjustmentPayload,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
} from '../../basicToneCommandBridge';
import { selectEditDocumentNode } from '../../editDocumentSelectors';
import {
  applySelectiveColorCommandEnvelopeToAdjustments,
  buildSelectiveColorCommandEnvelope,
  buildSelectiveColorImageCommandContext,
  type SelectiveColorAdjustmentPayload,
  type SelectiveColorCommandColorPipeline,
} from '../../selectiveColorCommandBridge';
import {
  type AgentLiveBasicTonePixel,
  hashBasicTonePreviewPixels,
  renderBasicTonePreviewPixels,
} from '../session/agentLiveBasicTone';
import { createLiveEditorAppServerBridge } from '../session/agentLiveEditorCoreState';

export type AgentCoreEditCommandBundleStep =
  | { kind: 'basic_tone'; payload: BasicToneAdjustmentPayload }
  | { kind: 'selective_color'; payload: SelectiveColorAdjustmentPayload };

export interface AgentCoreEditCommandBundleOptions {
  bridge?: RawEngineLocalAppServerBridge;
  operationId: string;
  sessionId: string;
  steps: readonly AgentCoreEditCommandBundleStep[];
}

export interface AgentCoreEditCommandBundleResult {
  appliedGraphRevision: string;
  changedPixelCount: number;
  dryRuns: ToneColorDryRunResultV1[];
  mutations: ToneColorMutationResultV1[];
  outputHash: string;
}

const PREVIEW_PIXELS: readonly AgentLiveBasicTonePixel[] = [
  [0.1, 0.08, 0.06],
  [0.34, 0.3, 0.26],
  [0.58, 0.54, 0.48],
  [0.82, 0.76, 0.68],
];

const AGENT_COLOR_PIPELINE = {
  chromaticAdaptation: {
    method: 'bradford_v1',
    sourceWhitePoint: { x: 0.3457, y: 0.3585 },
    status: 'math_validated',
    targetWhitePoint: { x: 0.32168, y: 0.33767 },
    warnings: [],
  },
  inputDomain: 'camera_linear_rgb',
  operationDomain: 'acescg_linear_v1',
  renderTarget: {
    bitDepth: 8,
    embedIcc: true,
    intent: 'relative_colorimetric',
    outputProfile: 'display_p3',
    viewTransform: 'rawengine_agx_v1',
  },
  sceneToDisplayTransform: 'rawengine_agx_v1',
  workingSpace: 'acescg_linear_v1',
} as const satisfies SelectiveColorCommandColorPipeline;

export const runAgentCoreEditCommandBundle = async ({
  bridge = createLiveEditorAppServerBridge(),
  operationId,
  sessionId,
  steps,
}: AgentCoreEditCommandBundleOptions): Promise<AgentCoreEditCommandBundleResult> => {
  const initialState = useEditorStore.getState();
  const imagePath = initialState.selectedImage?.path;
  if (imagePath === undefined) throw new Error('Cannot run agent command bundle without a selected image.');
  const commitIdentity = captureAgentToolCommitIdentity(initialState);
  if (commitIdentity === null) throw new Error('Cannot run agent command bundle without a selected image session.');
  if (steps.length === 0) throw new Error('Agent command bundle requires at least one command step.');

  const dryRuns: ToneColorDryRunResultV1[] = [];
  const mutations: ToneColorMutationResultV1[] = [];
  const initialTone = selectEditDocumentNode(initialState.editDocumentV2, 'scene_global_color_tone').params;
  const initialDetail = selectEditDocumentNode(initialState.editDocumentV2, 'detail_denoise_dehaze').params;
  const initialColor = selectEditDocumentNode(initialState.editDocumentV2, 'color_presence').params;
  let nextBasic = {
    ...initialTone,
    clarity: initialDetail.clarity,
    saturation: initialColor.saturation,
  };
  let nextSelective = selectEditDocumentNode(initialState.editDocumentV2, 'selective_color_mixer').params;
  let outputPixels = [...PREVIEW_PIXELS];
  let currentGraphRevision = `history_${initialState.historyIndex}`;

  for (const [index, step] of steps.entries()) {
    if (step.kind === 'basic_tone') {
      const context = buildBasicToneImageCommandContext({
        expectedGraphRevision: currentGraphRevision,
        imagePath,
        operationId: `${operationId}_${index}`,
        sessionId,
      });
      const dryRunCommand = buildBasicToneCommandEnvelope(step.payload, context, { dryRun: true });
      const dryRunDispatch = await bridge.dispatch(dryRunCommand);
      if (!dryRunDispatch.ok) throw new Error(`Agent basic-tone bundle dry-run failed: ${dryRunDispatch.message}`);
      const dryRun = toneColorDryRunResultV1Schema.parse(dryRunDispatch.result);
      const acceptedDryRunPlanHash = dryRun.dryRunPlanHash;
      const acceptedDryRunPlanId = dryRun.dryRunPlanId;
      if (acceptedDryRunPlanHash === undefined || acceptedDryRunPlanId === undefined) {
        throw new Error('Agent basic-tone bundle dry-run did not return a plan identity.');
      }

      const applyCommand = buildBasicToneCommandEnvelope(step.payload, context, {
        acceptedDryRunPlanHash,
        acceptedDryRunPlanId,
        dryRun: false,
      });
      const applyDispatch = await bridge.dispatch(applyCommand);
      if (!applyDispatch.ok) throw new Error(`Agent basic-tone bundle apply failed: ${applyDispatch.message}`);
      const mutation = toneColorMutationResultV1Schema.parse(applyDispatch.result);

      dryRuns.push(dryRun);
      mutations.push(mutation);
      nextBasic = applyBasicToneCommandEnvelopeToAdjustments(nextBasic, applyCommand);
      outputPixels = renderBasicTonePreviewPixels(outputPixels, applyCommand);
      currentGraphRevision = mutation.appliedGraphRevision;
      continue;
    }

    const context = buildSelectiveColorImageCommandContext({
      colorPipeline: AGENT_COLOR_PIPELINE,
      expectedGraphRevision: currentGraphRevision,
      imagePath,
      operationId: `${operationId}_${index}`,
      sessionId,
    });
    const dryRunCommand = buildSelectiveColorCommandEnvelope(step.payload, context, { dryRun: true });
    const dryRunDispatch = await bridge.dispatch(dryRunCommand);
    if (!dryRunDispatch.ok) throw new Error(`Agent selective-color bundle dry-run failed: ${dryRunDispatch.message}`);
    const dryRun = toneColorDryRunResultV1Schema.parse(dryRunDispatch.result);
    const acceptedDryRunPlanHash = dryRun.dryRunPlanHash;
    const acceptedDryRunPlanId = dryRun.dryRunPlanId;
    if (acceptedDryRunPlanHash === undefined || acceptedDryRunPlanId === undefined) {
      throw new Error('Agent selective-color bundle dry-run did not return a plan identity.');
    }

    const applyCommand = buildSelectiveColorCommandEnvelope(step.payload, context, {
      acceptedDryRunPlanHash,
      acceptedDryRunPlanId,
      dryRun: false,
    });
    const applyDispatch = await bridge.dispatch(applyCommand);
    if (!applyDispatch.ok) throw new Error(`Agent selective-color bundle apply failed: ${applyDispatch.message}`);
    const mutation = toneColorMutationResultV1Schema.parse(applyDispatch.result);

    dryRuns.push(dryRun);
    mutations.push(mutation);
    nextSelective = applySelectiveColorCommandEnvelopeToAdjustments(nextSelective, applyCommand);
    currentGraphRevision = mutation.appliedGraphRevision;
  }

  const initialHash = hashBasicTonePreviewPixels(PREVIEW_PIXELS);
  const outputHash = hashBasicTonePreviewPixels(outputPixels);
  const changedPixelCount = outputPixels.filter((pixel, index) =>
    pixel.some((channel, channelIndex) => channel !== PREVIEW_PIXELS[index]?.[channelIndex]),
  ).length;
  if (initialHash === outputHash || changedPixelCount === 0) {
    throw new Error('Agent command bundle did not visibly affect rendered output.');
  }

  const currentState = useEditorStore.getState();
  currentState.applyEditTransaction(
    buildAgentToolEditTransaction(
      currentState,
      commitIdentity,
      [
        {
          nodeType: 'scene_global_color_tone',
          patch: {
            blacks: nextBasic.blacks,
            brightness: nextBasic.brightness,
            contrast: nextBasic.contrast,
            exposure: nextBasic.exposure,
            highlights: nextBasic.highlights,
            shadows: nextBasic.shadows,
            whites: nextBasic.whites,
          },
          type: 'patch-edit-document-node',
        },
        {
          nodeType: 'detail_denoise_dehaze',
          patch: { clarity: nextBasic.clarity },
          type: 'patch-edit-document-node',
        },
        {
          nodeType: 'color_presence',
          patch: { saturation: nextBasic.saturation },
          type: 'patch-edit-document-node',
        },
        {
          nodeType: 'selective_color_mixer',
          patch: nextSelective,
          type: 'patch-edit-document-node',
        },
      ],
      `${operationId}_apply`,
    ),
  );

  return {
    appliedGraphRevision: currentGraphRevision,
    changedPixelCount,
    dryRuns,
    mutations,
    outputHash,
  };
};
