import { z } from 'zod';

import { toMaskParameterRecord, type MaskParameterRecord } from './maskParameterAccess';

import type { SubMask } from '../components/panel/right/Masks';
import type { RenderSize } from '../hooks/useImageRenderSize';

export const objectPromptModeSchema = z.enum(['foreground_point', 'background_point', 'box']);
export const objectPromptPointSchema = z
  .object({
    label: z.enum(['foreground', 'background']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
export const objectPromptBoxSchema = z
  .object({
    height: z.number().positive().max(1),
    width: z.number().positive().max(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((box, context) => {
    if (box.x + box.width > 1) context.addIssue({ code: 'custom', message: 'box exceeds image width' });
    if (box.y + box.height > 1) context.addIssue({ code: 'custom', message: 'box exceeds image height' });
  });

export type ObjectPromptMode = z.infer<typeof objectPromptModeSchema>;
export type ObjectPromptPoint = z.infer<typeof objectPromptPointSchema>;
export type ObjectPromptBox = z.infer<typeof objectPromptBoxSchema>;

export interface ObjectPromptCanvasState {
  boxPrompt: ObjectPromptBox | null;
  mode: ObjectPromptMode;
  pendingBoxAnchor: ObjectPromptPoint | null;
  pointPrompts: Array<ObjectPromptPoint>;
}

export const aiObjectMaskProposalSchema = z
  .object({
    clickToMaskLatencyMs: z.number().nonnegative(),
    decoderLatencyMs: z.number().nonnegative(),
    embeddingLatencyMs: z.number().nonnegative().nullable().optional(),
    imageHeight: z.number().int().positive(),
    imageWidth: z.number().int().positive(),
    maskDataBase64: z.string().trim().startsWith('data:image/png;base64,'),
    modelId: z.string().trim().min(1),
    promptCount: z.number().int().positive(),
    promptKind: z.enum(['box', 'point']),
    providerId: z.string().trim().min(1),
  })
  .strict();

export type AiObjectMaskProposal = z.infer<typeof aiObjectMaskProposalSchema>;

export const objectMaskProposalReplayReceiptSchema = z
  .object({
    boxHeight: z.number().min(0).max(1).nullable(),
    boxReady: z.boolean(),
    boxWidth: z.number().min(0).max(1).nullable(),
    boxX: z.number().min(0).max(1).nullable(),
    boxY: z.number().min(0).max(1).nullable(),
    clickToMaskLatencyMs: z.number().nonnegative(),
    hasRaster: z.boolean(),
    imageHeight: z.number().int().positive(),
    imageWidth: z.number().int().positive(),
    modelId: z.string().trim().min(1),
    pointCount: z.number().int().nonnegative(),
    promptCount: z.number().int().positive(),
    promptKind: z.enum(['box', 'point']),
    providerId: z.string().trim().min(1),
    providerStatus: z.string().trim().min(1),
    receiptVersion: z.literal(1),
  })
  .strict();

export type ObjectMaskProposalReplayReceipt = z.infer<typeof objectMaskProposalReplayReceiptSchema>;

export interface CanvasHitPoint {
  x: number;
  y: number;
}

export interface ObjectMaskProposalCommandInput {
  endPoint: [number, number];
  promptKind: 'box' | 'point';
  startPoint: [number, number];
}

export interface ObjectPromptImageDimensions {
  height: number;
  orientationSteps: number;
  width: number;
}

const DEFAULT_MODE: ObjectPromptMode = 'foreground_point';

const parsePoints = (value: unknown): Array<ObjectPromptPoint> => {
  const parsed = z.array(objectPromptPointSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
};

const parseBox = (value: unknown): ObjectPromptBox | null => {
  const parsed = objectPromptBoxSchema.nullable().safeParse(value);
  return parsed.success ? parsed.data : null;
};

const parseMode = (value: unknown): ObjectPromptMode => {
  const parsed = objectPromptModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_MODE;
};

export function readObjectPromptCanvasState(parameters: SubMask['parameters']): ObjectPromptCanvasState {
  const record = toMaskParameterRecord(parameters);
  return {
    boxPrompt: parseBox(record['boxPrompt']),
    mode: parseMode(record['promptMode']),
    pendingBoxAnchor: parseBoxAnchor(record),
    pointPrompts: parsePoints(record['pointPrompts']),
  };
}

export function writeObjectPromptCanvasState(
  parameters: SubMask['parameters'],
  state: ObjectPromptCanvasState,
): MaskParameterRecord {
  return {
    ...toMaskParameterRecord(parameters),
    boxPrompt: state.boxPrompt,
    pendingBoxAnchor: state.pendingBoxAnchor,
    pointPrompts: state.pointPrompts,
    promptMode: state.mode,
  };
}

export function imagePointFromCanvasClick(
  click: CanvasHitPoint,
  renderSize: Pick<RenderSize, 'height' | 'offsetX' | 'offsetY' | 'width'>,
): ObjectPromptPoint | null {
  if (renderSize.width <= 0 || renderSize.height <= 0) return null;
  const x = (click.x - renderSize.offsetX) / renderSize.width;
  const y = (click.y - renderSize.offsetY) / renderSize.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { label: 'foreground', x: clamp01(x), y: clamp01(y) };
}

export function applyObjectPromptClick(
  current: ObjectPromptCanvasState,
  point: ObjectPromptPoint,
): ObjectPromptCanvasState {
  if (current.mode === 'box') {
    if (current.pendingBoxAnchor === null) {
      return { ...current, pendingBoxAnchor: point };
    }
    return {
      ...current,
      boxPrompt: buildBox(current.pendingBoxAnchor, point),
      pendingBoxAnchor: null,
    };
  }
  const label: ObjectPromptPoint['label'] = current.mode === 'background_point' ? 'background' : 'foreground';
  return {
    ...current,
    pendingBoxAnchor: null,
    pointPrompts: [...current.pointPrompts, { label, x: point.x, y: point.y }].slice(-12),
  };
}

export function setObjectPromptMode(current: ObjectPromptCanvasState, mode: ObjectPromptMode): ObjectPromptCanvasState {
  return { ...current, mode, pendingBoxAnchor: mode === 'box' ? current.pendingBoxAnchor : null };
}

export function clearObjectPromptCanvasState(current: ObjectPromptCanvasState): ObjectPromptCanvasState {
  return { ...current, boxPrompt: null, pendingBoxAnchor: null, pointPrompts: [] };
}

export function buildObjectMaskProposalCommandInput(
  state: ObjectPromptCanvasState,
  dimensions: ObjectPromptImageDimensions,
): ObjectMaskProposalCommandInput | null {
  const orientedWidth = dimensions.orientationSteps % 2 === 1 ? dimensions.height : dimensions.width;
  const orientedHeight = dimensions.orientationSteps % 2 === 1 ? dimensions.width : dimensions.height;
  if (orientedWidth <= 0 || orientedHeight <= 0) return null;

  if (state.boxPrompt !== null) {
    const start = toPixelPoint(state.boxPrompt.x, state.boxPrompt.y, orientedWidth, orientedHeight);
    const end = toPixelPoint(
      state.boxPrompt.x + state.boxPrompt.width,
      state.boxPrompt.y + state.boxPrompt.height,
      orientedWidth,
      orientedHeight,
    );
    return { endPoint: end, promptKind: 'box', startPoint: start };
  }

  const foregroundPoint =
    state.pointPrompts.find((prompt) => prompt.label === 'foreground') ??
    state.pointPrompts.find((prompt) => prompt.label !== 'background');
  if (foregroundPoint === undefined) return null;
  const point = toPixelPoint(foregroundPoint.x, foregroundPoint.y, orientedWidth, orientedHeight);
  return { endPoint: point, promptKind: 'point', startPoint: point };
}

export function acceptObjectMaskProposal(
  parameters: SubMask['parameters'],
  state: ObjectPromptCanvasState,
  proposal: AiObjectMaskProposal,
): MaskParameterRecord {
  const parsedProposal = aiObjectMaskProposalSchema.parse(proposal);
  return {
    ...writeObjectPromptCanvasState(parameters, state),
    maskDataBase64: parsedProposal.maskDataBase64,
    objectPromptAcceptedAt: new Date().toISOString(),
    proposal: parsedProposal,
    providerStatus: 'local_sam_proposal_v1',
  };
}

export function readObjectMaskProposalReplayReceipt(
  parameters: SubMask['parameters'],
): ObjectMaskProposalReplayReceipt | null {
  const record = toMaskParameterRecord(parameters);
  const proposal = aiObjectMaskProposalSchema.safeParse(record['proposal']);
  if (!proposal.success) return null;

  const state = readObjectPromptCanvasState(parameters);
  const receipt = {
    boxHeight: state.boxPrompt?.height ?? null,
    boxReady: state.boxPrompt !== null,
    boxWidth: state.boxPrompt?.width ?? null,
    boxX: state.boxPrompt?.x ?? null,
    boxY: state.boxPrompt?.y ?? null,
    clickToMaskLatencyMs: proposal.data.clickToMaskLatencyMs,
    hasRaster:
      typeof record['maskDataBase64'] === 'string' && record['maskDataBase64'].startsWith('data:image/png;base64,'),
    imageHeight: proposal.data.imageHeight,
    imageWidth: proposal.data.imageWidth,
    modelId: proposal.data.modelId,
    pointCount: state.pointPrompts.length,
    promptCount: proposal.data.promptCount,
    promptKind: proposal.data.promptKind,
    providerId: proposal.data.providerId,
    providerStatus: typeof record['providerStatus'] === 'string' ? record['providerStatus'] : 'unknown',
    receiptVersion: 1,
  };

  return objectMaskProposalReplayReceiptSchema.parse(receipt);
}

function parseBoxAnchor(record: MaskParameterRecord): ObjectPromptPoint | null {
  const parsed = objectPromptPointSchema.nullable().safeParse(record['pendingBoxAnchor']);
  return parsed.success ? parsed.data : null;
}

function buildBox(anchor: ObjectPromptPoint, point: ObjectPromptPoint): ObjectPromptBox {
  const x = Math.min(anchor.x, point.x);
  const y = Math.min(anchor.y, point.y);
  const width = Math.max(Math.abs(anchor.x - point.x), 0.001);
  const height = Math.max(Math.abs(anchor.y - point.y), 0.001);
  return objectPromptBoxSchema.parse({
    height: Math.min(height, 1 - y),
    width: Math.min(width, 1 - x),
    x,
    y,
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toPixelPoint(x: number, y: number, width: number, height: number): [number, number] {
  return [Math.round(clamp01(x) * width), Math.round(clamp01(y) * height)];
}
