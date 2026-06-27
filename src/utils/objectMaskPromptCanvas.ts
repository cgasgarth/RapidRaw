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

export interface CanvasHitPoint {
  x: number;
  y: number;
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
