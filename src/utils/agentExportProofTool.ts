import { z } from 'zod';

import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import {
  exportRecipeColorProfileV1Schema,
  exportRecipeFileFormatV1Schema,
  exportRecipeRenderingIntentV1Schema,
} from '../../packages/rawengine-schema/src/exportRecipeSchemas';
import { useEditorStore } from '../store/useEditorStore';

export const AGENT_EXPORT_PROOF_TOOL_NAME = 'rawengine.agent.export.proof';
export const AGENT_EXPORT_PROOF_INPUT_SCHEMA_NAME = 'AgentExportProofRequestV1';
export const AGENT_EXPORT_PROOF_OUTPUT_SCHEMA_NAME = 'AgentExportProofResponseV1';

const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const agentExportProofRequestSchema = z
  .object({
    colorProfile: exportRecipeColorProfileV1Schema.default('srgb'),
    dryRun: z.literal(true),
    expectedRecipeHash: z.string().trim().min(1),
    fileFormat: exportRecipeFileFormatV1Schema.extract(['jpeg', 'png']).default('jpeg'),
    jpegQuality: z.number().int().min(50).max(95).default(86),
    longEdgePx: z.number().int().min(256).max(2048).default(1536),
    operationId: z.string().trim().min(1),
    renderingIntent: exportRecipeRenderingIntentV1Schema.default('relativeColorimetric'),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentExportProofResponseSchema = z
  .object({
    dryRun: z.literal(true),
    exportHash: z.string().trim().min(1),
    fileWritten: z.literal(false),
    output: z
      .object({
        colorProfile: exportRecipeColorProfileV1Schema,
        fileFormat: exportRecipeFileFormatV1Schema.extract(['jpeg', 'png']),
        height: z.number().int().positive(),
        jpegQuality: z.number().int().min(50).max(95),
        mediaType: z.enum(['image/jpeg', 'image/png']),
        previewRef: z.string().trim().min(1),
        renderingIntent: exportRecipeRenderingIntentV1Schema,
        width: z.number().int().positive(),
      })
      .strict(),
    receipt: z
      .object({
        activeImagePath: z.string().trim().min(1),
        graphRevision: z.string().trim().min(1),
        operationId: z.string().trim().min(1),
        previewRenderHash: z.string().trim().min(1),
        recipeHash: z.string().trim().min(1),
        requestId: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_EXPORT_PROOF_TOOL_NAME),
  })
  .strict();

export type AgentExportProofRequest = z.infer<typeof agentExportProofRequestSchema>;
export type AgentExportProofResponse = z.infer<typeof agentExportProofResponseSchema>;

const fitDimensions = (width: number, height: number, longEdgePx: number): { height: number; width: number } => {
  const longEdge = Math.max(width, height);
  if (longEdge <= 0) return { height: longEdgePx, width: longEdgePx };
  const scale = Math.min(1, longEdgePx / longEdge);
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
};

export const buildAgentExportProof = (request: AgentExportProofRequest): AgentExportProofResponse => {
  const parsedRequest = agentExportProofRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  if (parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent export proof rejected stale recipe hash.');
  }

  const editor = useEditorStore.getState();
  const selectedImage = editor.selectedImage;
  if (selectedImage === null) throw new Error('Agent export proof requires a selected image.');

  const dimensions = fitDimensions(selectedImage.width, selectedImage.height, parsedRequest.longEdgePx);
  const mediaType = parsedRequest.fileFormat === 'png' ? 'image/png' : 'image/jpeg';
  const previewRef = `agent-export-proof:${parsedRequest.operationId}:${snapshot.initialPreview.renderHash}`;
  const exportHash = stableHash(
    JSON.stringify({
      adjustments: editor.adjustments,
      colorProfile: parsedRequest.colorProfile,
      dimensions,
      fileFormat: parsedRequest.fileFormat,
      graphRevision: snapshot.graphRevision,
      jpegQuality: parsedRequest.jpegQuality,
      recipeHash: snapshot.initialPreview.recipeHash,
      renderingIntent: parsedRequest.renderingIntent,
      selectedImagePath: selectedImage.path,
    }),
  );

  return agentExportProofResponseSchema.parse({
    dryRun: true,
    exportHash,
    fileWritten: false,
    output: {
      colorProfile: parsedRequest.colorProfile,
      fileFormat: parsedRequest.fileFormat,
      height: dimensions.height,
      jpegQuality: parsedRequest.jpegQuality,
      mediaType,
      previewRef,
      renderingIntent: parsedRequest.renderingIntent,
      width: dimensions.width,
    },
    receipt: {
      activeImagePath: snapshot.activeImagePath,
      graphRevision: snapshot.graphRevision,
      operationId: parsedRequest.operationId,
      previewRenderHash: snapshot.initialPreview.renderHash,
      recipeHash: snapshot.initialPreview.recipeHash,
      requestId: parsedRequest.requestId,
      sessionId: parsedRequest.sessionId,
    },
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_EXPORT_PROOF_TOOL_NAME,
  });
};
