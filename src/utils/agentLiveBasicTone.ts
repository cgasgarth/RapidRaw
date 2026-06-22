import { createLiveEditorAppServerBridge } from './agentLiveEditorState';
import {
  applyBasicToneCommandEnvelopeToAdjustments,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  type LegacyBasicToneAdjustmentPayload,
  type BasicToneCommandEnvelope,
} from './basicToneCommandBridge';
import { pushEditHistoryEntry } from './editHistory';
import {
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
  type ToneColorMutationResultV1,
} from '../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../store/useEditorStore';

export type AgentLiveBasicTonePixel = readonly [number, number, number];

export interface AgentLiveBasicToneApplyOptions {
  operationId: string;
  requestedAdjustments: LegacyBasicToneAdjustmentPayload;
  sessionId: string;
}

export interface AgentLiveBasicToneApplyResult {
  appliedGraphRevision: string;
  beforePreviewHash: string;
  afterPreviewHash: string;
  changedPixelCount: number;
  command: BasicToneCommandEnvelope;
  mutation: ToneColorMutationResultV1;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const renderBasicTonePreviewPixels = (
  pixels: readonly AgentLiveBasicTonePixel[],
  command: BasicToneCommandEnvelope,
): AgentLiveBasicTonePixel[] =>
  pixels.map((pixel): AgentLiveBasicTonePixel => {
    const { blackPoint, clarity, contrast, exposureEv, highlights, saturation, shadows, whitePoint } =
      command.parameters;
    const exposureScale = 2 ** exposureEv;
    const contrastScale = 1 + contrast / 100;
    const saturationScale = 1 + saturation / 100;
    const lift = (shadows - blackPoint) / 500;
    const shoulder = (whitePoint - highlights) / 500;
    const localContrast = clarity / 800;
    const mean = pixel.reduce((sum, channel) => sum + channel, 0) / pixel.length;

    return [
      Number(clamp01((pixel[0] * exposureScale + lift + shoulder - 0.5) * contrastScale + 0.5).toFixed(6)),
      Number(
        clamp01(
          mean +
            ((pixel[1] * exposureScale + lift + shoulder - 0.5) * contrastScale + 0.5 - mean) * saturationScale +
            localContrast * (pixel[1] - mean),
        ).toFixed(6),
      ),
      Number(clamp01((pixel[2] * exposureScale + lift + shoulder - 0.5) * contrastScale + 0.5).toFixed(6)),
    ];
  });

export const hashBasicTonePreviewPixels = (pixels: readonly AgentLiveBasicTonePixel[]): string =>
  Array.from(JSON.stringify(pixels))
    .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)
    .toString(16);

export const applyBasicToneToLiveEditor = async ({
  operationId,
  requestedAdjustments,
  sessionId,
}: AgentLiveBasicToneApplyOptions): Promise<AgentLiveBasicToneApplyResult> => {
  const initialState = useEditorStore.getState();
  const imagePath = initialState.selectedImage?.path;
  if (imagePath === undefined) throw new Error('Cannot apply agent basic tone without a selected image.');

  const expectedGraphRevision = `history_${initialState.historyIndex}`;
  const context = buildBasicToneImageCommandContext({ expectedGraphRevision, imagePath, operationId, sessionId });
  const dryRunCommand = buildBasicToneCommandEnvelope(requestedAdjustments, context, { dryRun: true });
  const bridge = createLiveEditorAppServerBridge();
  const dryRun = await bridge.dispatch(dryRunCommand);
  if (!dryRun.ok) throw new Error(`Agent basic-tone dry-run failed: ${dryRun.message}`);

  const dryRunResult = toneColorDryRunResultV1Schema.parse(dryRun.result);
  if (dryRunResult.dryRunPlanHash === undefined || dryRunResult.dryRunPlanId === undefined) {
    throw new Error('Agent basic-tone dry-run did not return an accepted plan identity.');
  }

  const applyCommand = buildBasicToneCommandEnvelope(requestedAdjustments, context, {
    acceptedDryRunPlanHash: dryRunResult.dryRunPlanHash,
    acceptedDryRunPlanId: dryRunResult.dryRunPlanId,
    dryRun: false,
  });
  const apply = await bridge.dispatch(applyCommand);
  if (!apply.ok) throw new Error(`Agent basic-tone apply failed: ${apply.message}`);
  const mutation = toneColorMutationResultV1Schema.parse(apply.result);

  const beforePreviewPixels: readonly AgentLiveBasicTonePixel[] = [
    [0.12, 0.1, 0.08],
    [0.36, 0.32, 0.28],
    [0.72, 0.68, 0.6],
    [0.9, 0.84, 0.76],
  ];
  const afterPreviewPixels = renderBasicTonePreviewPixels(beforePreviewPixels, applyCommand);
  const beforePreviewHash = hashBasicTonePreviewPixels(beforePreviewPixels);
  const afterPreviewHash = hashBasicTonePreviewPixels(afterPreviewPixels);
  const changedPixelCount = afterPreviewPixels.filter((pixel, index) =>
    pixel.some((channel, channelIndex) => channel !== beforePreviewPixels[index]?.[channelIndex]),
  ).length;
  if (beforePreviewHash === afterPreviewHash || changedPixelCount === 0) {
    throw new Error('Agent basic-tone apply did not change rendered preview pixels.');
  }

  useEditorStore.setState((state) => {
    const adjustments = applyBasicToneCommandEnvelopeToAdjustments(state.adjustments, applyCommand);
    const history = pushEditHistoryEntry(state.history, state.historyIndex, adjustments);
    return {
      adjustments,
      finalPreviewUrl: `rawengine-preview://${mutation.appliedGraphRevision}/${afterPreviewHash}`,
      history: history.history,
      historyIndex: history.historyIndex,
      lastBasicToneCommand: applyCommand,
      uncroppedAdjustedPreviewUrl: `rawengine-preview://${mutation.appliedGraphRevision}/uncropped/${afterPreviewHash}`,
    };
  });

  return {
    afterPreviewHash,
    appliedGraphRevision: mutation.appliedGraphRevision,
    beforePreviewHash,
    changedPixelCount,
    command: applyCommand,
    mutation,
  };
};
