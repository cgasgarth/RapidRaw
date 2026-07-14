import { z } from 'zod';

export const pointColorPickerResponseSchema = z
  .object({
    chroma: z.number().finite().min(0),
    confidence: z.number().finite().min(0).max(1),
    graphFingerprint: z.string().min(1),
    graphRevision: z.string().min(1),
    hueDegrees: z.number().finite().min(0).max(360),
    lightness: z.number().finite(),
    sampleRadiusPx: z.number().int().positive(),
    sourceFingerprint: z.string().min(1),
    sourceIdentity: z.string().min(1),
  })
  .strict();

export type PointColorPickerResponse = z.infer<typeof pointColorPickerResponseSchema>;

export const isPointColorPickerResultCurrent = (
  result: PointColorPickerResponse,
  current: { active: boolean; graphRevision: string; sourceIdentity: string },
): boolean =>
  current.active && result.graphRevision === current.graphRevision && result.sourceIdentity === current.sourceIdentity;
