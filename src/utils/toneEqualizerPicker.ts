import { z } from 'zod';

import type { Adjustments } from './adjustments';

export const toneEqualizerPlacementResponseSchema = z
  .object({
    confidence: z.number().finite().min(0).max(1),
    histogram: z.array(z.number().int().nonnegative()).length(32),
    pivotEv: z.number().finite(),
    rangeEv: z.number().finite().min(4).max(24),
    sceneBlackEv: z.number().finite(),
    sceneWhiteEv: z.number().finite(),
    sourceIdentity: z.string().min(1),
    sourceFingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
  })
  .strict();

export const toneEqualizerPickerResponseSchema = z
  .object({
    contributingWeights: z.array(z.number().finite()).length(9),
    exposureEv: z.number().finite(),
    graphFingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
    graphRevision: z.string().min(1),
    primaryBand: z.number().int().min(0).max(8),
    sourceIdentity: z.string().min(1),
    sourceFingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
  })
  .strict();

export type ToneEqualizerPickerResponse = z.infer<typeof toneEqualizerPickerResponseSchema>;

export const isToneEqualizerPickerResultCurrent = (
  result: ToneEqualizerPickerResponse,
  current: { active: boolean; graphRevision: string; sourceIdentity: string },
): boolean =>
  current.active && result.graphRevision === current.graphRevision && result.sourceIdentity === current.sourceIdentity;

export const applyToneEqualizerPickerSelection = (
  adjustments: Adjustments,
  result: ToneEqualizerPickerResponse,
): Adjustments => ({
  ...adjustments,
  rawEngineEditGraphVersion: 2,
  toneEqualizer: {
    ...adjustments.toneEqualizer,
    previewMode: 2,
    selectedBand: result.primaryBand,
  },
});

export const applyToneEqualizerTargetedDelta = (
  adjustments: Adjustments,
  result: ToneEqualizerPickerResponse,
  deltaEv: number,
): Adjustments => ({
  ...adjustments,
  rawEngineEditGraphVersion: 2,
  toneEqualizer: {
    ...adjustments.toneEqualizer,
    bandEv: adjustments.toneEqualizer.bandEv.map((value, index) =>
      Math.max(-4, Math.min(4, value + deltaEv * (result.contributingWeights[index] ?? 0))),
    ) as Adjustments['toneEqualizer']['bandEv'],
    enabled: true,
    previewMode: 2,
    selectedBand: result.primaryBand,
  },
});
