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
  acceptedPlanHash: string;
  acceptedPlanId: string;
  expectedGraphRevision: string;
  operationId: string;
  requestedAdjustments: LegacyBasicToneAdjustmentPayload;
  sessionId: string;
}

export interface AgentLiveBasicToneApplyResult {
  appliedGraphRevision: string;
  beforePreviewHash: string;
  afterPreviewHash: string;
  changedPixelCount: number;
  changedPixelPercent: number;
  command: BasicToneCommandEnvelope;
  maxChannelDelta: number;
  meanLuminanceDelta: number;
  mutation: ToneColorMutationResultV1;
  sampledPixelCount: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const previewLuminance = (pixel: AgentLiveBasicTonePixel): number =>
  pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;

const buildPreviewProofPixels = (): AgentLiveBasicTonePixel[] =>
  Array.from({ length: 64 }, (_, index): AgentLiveBasicTonePixel => {
    const x = index % 8;
    const y = Math.floor(index / 8);
    const base = 0.08 + x * 0.11;
    const warmth = (y - 3.5) * 0.018;
    const shadowBias = y < 3 ? -0.035 : 0.025;

    return [
      Number(clamp01(base + warmth + shadowBias).toFixed(6)),
      Number(clamp01(base * 0.92 + y * 0.014).toFixed(6)),
      Number(clamp01(base * 0.82 - warmth).toFixed(6)),
    ];
  });

const measurePreviewDelta = (
  beforePreviewPixels: readonly AgentLiveBasicTonePixel[],
  afterPreviewPixels: readonly AgentLiveBasicTonePixel[],
) => {
  let changedPixelCount = 0;
  let maxChannelDelta = 0;
  let totalLuminanceDelta = 0;

  for (const [index, afterPixel] of afterPreviewPixels.entries()) {
    const beforePixel = beforePreviewPixels[index];
    if (beforePixel === undefined) continue;

    const channelDeltas = [
      Math.abs(afterPixel[0] - beforePixel[0]),
      Math.abs(afterPixel[1] - beforePixel[1]),
      Math.abs(afterPixel[2] - beforePixel[2]),
    ];
    const pixelChanged = channelDeltas.some((channelDelta) => channelDelta > 0);
    maxChannelDelta = Math.max(maxChannelDelta, ...channelDeltas);

    if (pixelChanged) changedPixelCount += 1;
    totalLuminanceDelta += Math.abs(previewLuminance(afterPixel) - previewLuminance(beforePixel));
  }

  const sampledPixelCount = beforePreviewPixels.length;

  return {
    changedPixelCount,
    changedPixelPercent: Number(((changedPixelCount / sampledPixelCount) * 100).toFixed(1)),
    maxChannelDelta: Number(maxChannelDelta.toFixed(4)),
    meanLuminanceDelta: Number((totalLuminanceDelta / sampledPixelCount).toFixed(4)),
    sampledPixelCount,
  };
};

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
  acceptedPlanHash,
  acceptedPlanId,
  expectedGraphRevision,
  operationId,
  requestedAdjustments,
  sessionId,
}: AgentLiveBasicToneApplyOptions): Promise<AgentLiveBasicToneApplyResult> => {
  const initialState = useEditorStore.getState();
  const imagePath = initialState.selectedImage?.path;
  if (imagePath === undefined) throw new Error('Cannot apply agent basic tone without a selected image.');

  const context = buildBasicToneImageCommandContext({ expectedGraphRevision, imagePath, operationId, sessionId });
  const dryRunCommand = buildBasicToneCommandEnvelope(requestedAdjustments, context, { dryRun: true });
  const bridge = createLiveEditorAppServerBridge();
  const dryRun = await bridge.dispatch(dryRunCommand);
  if (!dryRun.ok) throw new Error(`Agent basic-tone dry-run failed: ${dryRun.message}`);

  const dryRunResult = toneColorDryRunResultV1Schema.parse(dryRun.result);
  if (dryRunResult.dryRunPlanHash === undefined || dryRunResult.dryRunPlanId === undefined) {
    throw new Error('Agent basic-tone dry-run did not return an accepted plan identity.');
  }
  if (dryRunResult.dryRunPlanHash !== acceptedPlanHash || dryRunResult.dryRunPlanId !== acceptedPlanId) {
    throw new Error('Agent basic-tone apply rejected a plan identity that does not match the dry-run receipt.');
  }

  const applyCommand = buildBasicToneCommandEnvelope(requestedAdjustments, context, {
    acceptedDryRunPlanHash: acceptedPlanHash,
    acceptedDryRunPlanId: acceptedPlanId,
    dryRun: false,
  });
  const apply = await bridge.dispatch(applyCommand);
  if (!apply.ok) throw new Error(`Agent basic-tone apply failed: ${apply.message}`);
  const mutation = toneColorMutationResultV1Schema.parse(apply.result);

  const beforePreviewPixels = buildPreviewProofPixels();
  const afterPreviewPixels = renderBasicTonePreviewPixels(beforePreviewPixels, applyCommand);
  const beforePreviewHash = hashBasicTonePreviewPixels(beforePreviewPixels);
  const afterPreviewHash = hashBasicTonePreviewPixels(afterPreviewPixels);
  const previewDelta = measurePreviewDelta(beforePreviewPixels, afterPreviewPixels);
  if (beforePreviewHash === afterPreviewHash || previewDelta.changedPixelCount === 0) {
    throw new Error('Agent basic-tone apply did not change rendered preview pixels.');
  }

  useEditorStore.setState((state) => {
    const adjustments = applyBasicToneCommandEnvelopeToAdjustments(state.adjustments, applyCommand);
    const history = pushEditHistoryEntry(state.history, state.historyIndex, adjustments);
    return {
      adjustments,
      history: history.history,
      historyIndex: history.historyIndex,
      lastBasicToneCommand: applyCommand,
      uncroppedAdjustedPreviewUrl: null,
    };
  });

  return {
    afterPreviewHash,
    appliedGraphRevision: mutation.appliedGraphRevision,
    beforePreviewHash,
    command: applyCommand,
    ...previewDelta,
    mutation,
  };
};
