import { z } from 'zod';

import {
  hashBasicTonePreviewPixels,
  renderBasicTonePreviewPixels,
  type AgentLiveBasicTonePixel,
} from './agentLiveBasicTone';
import { createLiveEditorAppServerBridge } from './agentLiveEditorState';
import {
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  type BasicToneCommandEnvelope,
  type LegacyBasicToneAdjustmentPayload,
} from './basicToneCommandBridge';
import {
  artifactHandleV1Schema,
  toneColorDryRunResultV1Schema,
  type ArtifactHandleV1,
  type ToneColorDryRunResultV1,
} from '../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../store/useEditorStore';

export interface AgentBasicToneDryRunPreviewOptions {
  operationId: string;
  requestedAdjustments: LegacyBasicToneAdjustmentPayload;
  sessionId: string;
}

export interface AgentBasicToneDryRunPreviewArtifacts {
  afterArtifact: ArtifactHandleV1;
  afterPreviewHash: string;
  beforeArtifact: ArtifactHandleV1;
  beforePreviewHash: string;
  changedPixelCount: number;
  command: BasicToneCommandEnvelope;
  graphRevisionAfter: string;
  graphRevisionBefore: string;
  previewResult: ToneColorDryRunResultV1;
}

const agentBasicToneDryRunPreviewArtifactsProofSchema = z
  .object({
    afterArtifact: artifactHandleV1Schema,
    afterPreviewHash: z.string().trim().min(1),
    beforeArtifact: artifactHandleV1Schema,
    beforePreviewHash: z.string().trim().min(1),
    changedPixelCount: z.number().int().positive(),
    graphRevisionAfter: z.string().trim().min(1),
    graphRevisionBefore: z.string().trim().min(1),
    previewResult: toneColorDryRunResultV1Schema,
  })
  .strict();

const PREVIEW_PIXELS: readonly AgentLiveBasicTonePixel[] = [
  [0.08, 0.09, 0.1],
  [0.24, 0.26, 0.3],
  [0.5, 0.52, 0.55],
  [0.78, 0.74, 0.7],
  [0.94, 0.9, 0.86],
];

const buildPreviewArtifact = ({ artifactId, hash }: { artifactId: string; hash: string }): ArtifactHandleV1 =>
  artifactHandleV1Schema.parse({
    artifactId,
    contentHash: `sha256:${hash}`,
    dimensions: { height: 1, width: PREVIEW_PIXELS.length },
    kind: 'preview',
    storage: 'temp_cache',
  });

export const buildAgentBasicToneDryRunPreviewArtifacts = async ({
  operationId,
  requestedAdjustments,
  sessionId,
}: AgentBasicToneDryRunPreviewOptions): Promise<AgentBasicToneDryRunPreviewArtifacts> => {
  const editor = useEditorStore.getState();
  const imagePath = editor.selectedImage?.path;
  if (imagePath === undefined) throw new Error('Cannot preview agent basic tone without a selected image.');

  const graphRevisionBefore = `history_${editor.historyIndex}`;
  const context = buildBasicToneImageCommandContext({
    expectedGraphRevision: graphRevisionBefore,
    imagePath,
    operationId,
    sessionId,
  });
  const command = buildBasicToneCommandEnvelope(requestedAdjustments, context, { dryRun: true });
  const dryRun = await createLiveEditorAppServerBridge().dispatch(command);
  if (!dryRun.ok) throw new Error(`Agent basic-tone dry-run preview failed: ${dryRun.message}`);
  const previewResult = toneColorDryRunResultV1Schema.parse(dryRun.result);

  const afterPixels = renderBasicTonePreviewPixels(PREVIEW_PIXELS, command);
  const beforePreviewHash = hashBasicTonePreviewPixels(PREVIEW_PIXELS);
  const afterPreviewHash = hashBasicTonePreviewPixels(afterPixels);
  const changedPixelCount = afterPixels.filter((pixel, index) =>
    pixel.some((channel, channelIndex) => channel !== PREVIEW_PIXELS[index]?.[channelIndex]),
  ).length;
  const graphRevisionAfter = `history_${useEditorStore.getState().historyIndex}`;

  const afterArtifact = buildPreviewArtifact({
    artifactId: `artifact_agent_basic_tone_${operationId}_after_preview`,
    hash: afterPreviewHash,
  });
  const beforeArtifact = buildPreviewArtifact({
    artifactId: `artifact_agent_basic_tone_${operationId}_before_preview`,
    hash: beforePreviewHash,
  });

  agentBasicToneDryRunPreviewArtifactsProofSchema.parse({
    afterArtifact,
    afterPreviewHash,
    beforeArtifact,
    beforePreviewHash,
    changedPixelCount,
    graphRevisionAfter,
    graphRevisionBefore,
    previewResult,
  });

  return {
    afterArtifact,
    afterPreviewHash,
    beforeArtifact,
    beforePreviewHash,
    changedPixelCount,
    command,
    graphRevisionAfter,
    graphRevisionBefore,
    previewResult,
  };
};
