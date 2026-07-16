import { z } from 'zod';
import type { EditDocumentNodeParamsV2 } from '../../packages/rawengine-schema/src/editDocumentV2';

type ToneEqualizerSettings = EditDocumentNodeParamsV2<'tone_equalizer'>['toneEqualizer'];

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
  toneEqualizer: ToneEqualizerSettings,
  result: ToneEqualizerPickerResponse,
): ToneEqualizerSettings => ({
  ...toneEqualizer,
  previewMode: 2,
  selectedBand: result.primaryBand,
});

export const applyToneEqualizerTargetedDelta = (
  toneEqualizer: ToneEqualizerSettings,
  result: ToneEqualizerPickerResponse,
  deltaEv: number,
): ToneEqualizerSettings => ({
  ...toneEqualizer,
  bandEv: toneEqualizer.bandEv.map((value, index) =>
    Math.max(-4, Math.min(4, value + deltaEv * (result.contributingWeights[index] ?? 0))),
  ) as ToneEqualizerSettings['bandEv'],
  enabled: true,
  previewMode: 2,
  selectedBand: result.primaryBand,
});
