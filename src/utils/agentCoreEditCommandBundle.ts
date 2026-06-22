import {
  hashBasicTonePreviewPixels,
  renderBasicTonePreviewPixels,
  type AgentLiveBasicTonePixel,
} from './agentLiveBasicTone';
import { createLiveEditorAppServerBridge } from './agentLiveEditorState';
import {
  applyBasicToneCommandEnvelopeToAdjustments,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  type LegacyBasicToneAdjustmentPayload,
} from './basicToneCommandBridge';
import { pushEditHistoryEntry } from './editHistory';
import {
  applySelectiveColorCommandEnvelopeToAdjustments,
  buildSelectiveColorCommandEnvelope,
  buildSelectiveColorImageCommandContext,
  type SelectiveColorAdjustmentPayload,
  type SelectiveColorCommandColorPipeline,
} from './selectiveColorCommandBridge';
import {
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
  type ToneColorDryRunResultV1,
  type ToneColorMutationResultV1,
} from '../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../store/useEditorStore';

export type AgentCoreEditCommandBundleStep =
  | { kind: 'basic_tone'; payload: LegacyBasicToneAdjustmentPayload }
  | { kind: 'selective_color'; payload: SelectiveColorAdjustmentPayload };

export interface AgentCoreEditCommandBundleOptions {
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
  operationId,
  sessionId,
  steps,
}: AgentCoreEditCommandBundleOptions): Promise<AgentCoreEditCommandBundleResult> => {
  const initialState = useEditorStore.getState();
  const imagePath = initialState.selectedImage?.path;
  if (imagePath === undefined) throw new Error('Cannot run agent command bundle without a selected image.');
  if (steps.length === 0) throw new Error('Agent command bundle requires at least one command step.');

  const bridge = createLiveEditorAppServerBridge();
  const dryRuns: ToneColorDryRunResultV1[] = [];
  const mutations: ToneColorMutationResultV1[] = [];
  let nextAdjustments = initialState.adjustments;
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
      if (dryRun.dryRunPlanHash === undefined || dryRun.dryRunPlanId === undefined) {
        throw new Error('Agent basic-tone bundle dry-run did not return a plan identity.');
      }

      const applyCommand = buildBasicToneCommandEnvelope(step.payload, context, {
        acceptedDryRunPlanHash: dryRun.dryRunPlanHash,
        acceptedDryRunPlanId: dryRun.dryRunPlanId,
        dryRun: false,
      });
      const applyDispatch = await bridge.dispatch(applyCommand);
      if (!applyDispatch.ok) throw new Error(`Agent basic-tone bundle apply failed: ${applyDispatch.message}`);
      const mutation = toneColorMutationResultV1Schema.parse(applyDispatch.result);

      dryRuns.push(dryRun);
      mutations.push(mutation);
      nextAdjustments = applyBasicToneCommandEnvelopeToAdjustments(nextAdjustments, applyCommand);
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

    const applyCommand = buildSelectiveColorCommandEnvelope(step.payload, context, { dryRun: false });
    const applyDispatch = await bridge.dispatch(applyCommand);
    if (!applyDispatch.ok) throw new Error(`Agent selective-color bundle apply failed: ${applyDispatch.message}`);
    const mutation = toneColorMutationResultV1Schema.parse(applyDispatch.result);

    dryRuns.push(dryRun);
    mutations.push(mutation);
    nextAdjustments = applySelectiveColorCommandEnvelopeToAdjustments(nextAdjustments, applyCommand);
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

  useEditorStore.setState((state) => {
    const history = pushEditHistoryEntry(state.history, state.historyIndex, nextAdjustments);
    return {
      adjustments: nextAdjustments,
      finalPreviewUrl: `rawengine-preview://${currentGraphRevision}/${outputHash}`,
      history: history.history,
      historyIndex: history.historyIndex,
      uncroppedAdjustedPreviewUrl: `rawengine-preview://${currentGraphRevision}/uncropped/${outputHash}`,
    };
  });

  return {
    appliedGraphRevision: currentGraphRevision,
    changedPixelCount,
    dryRuns,
    mutations,
    outputHash,
  };
};
