import { z } from 'zod';

import { ActiveChannel } from './adjustments';
import { BASIC_TONE_ADJUSTMENT_KEYS } from './basicToneCommandBridge';
import { useEditorStore } from '../store/useEditorStore';

import type { Adjustments } from './adjustments';

const MAX_HISTOGRAM_BINS = 16;
const MAX_METADATA_ENTRIES = 8;
const MAX_ADJUSTMENT_ENTRIES = 16;

const agentImageContextClippingSchema = z
  .object({
    highlightsPercent: z.number().min(0).max(100),
    shadowsPercent: z.number().min(0).max(100),
  })
  .strict();

const agentImageContextSnapshotSchema = z
  .object({
    activeImagePath: z.string().trim().min(1),
    adjustmentSummary: z.array(z.object({ key: z.string().trim().min(1), value: z.unknown() }).strict()),
    clipping: agentImageContextClippingSchema,
    cropHint: z.object({ active: z.boolean(), aspectRatio: z.number().nullable() }).strict(),
    graphRevision: z.string().trim().min(1),
    histogramSummary: z
      .array(
        z
          .object({
            bins: z.array(z.number()).max(MAX_HISTOGRAM_BINS),
            channel: z.string().trim().min(1),
            max: z.number().nonnegative(),
            total: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(4),
    metadataSummary: z.array(z.object({ key: z.string().trim().min(1), value: z.string() }).strict()),
    previewIdentity: z.string().trim().min(1).nullable(),
    subjectHint: z.object({ hasActiveMask: z.boolean(), maskCount: z.number().int().nonnegative() }).strict(),
  })
  .strict();

export type AgentImageContextSnapshot = z.infer<typeof agentImageContextSnapshotSchema>;

const summarizeAdjustment = (adjustments: Adjustments): AgentImageContextSnapshot['adjustmentSummary'] =>
  BASIC_TONE_ADJUSTMENT_KEYS.map((key) => ({ key, value: adjustments[key] })).slice(0, MAX_ADJUSTMENT_ENTRIES);

const summarizeMetadata = (exif: Record<string, unknown> | undefined): AgentImageContextSnapshot['metadataSummary'] =>
  Object.entries(exif ?? {})
    .slice(0, MAX_METADATA_ENTRIES)
    .map(([key, value]) => ({ key, value: String(value) }));

const getHistogramData = (channel: unknown): number[] => {
  if (Array.isArray(channel)) return channel.filter((value): value is number => typeof value === 'number');
  if (typeof channel === 'object' && channel !== null && 'data' in channel) {
    const data = (channel as { data?: unknown }).data;
    if (Array.isArray(data)) return data.filter((value): value is number => typeof value === 'number');
  }
  return [];
};

const downsampleBins = (bins: readonly number[]): number[] => {
  if (bins.length <= MAX_HISTOGRAM_BINS) return [...bins];
  const groupSize = Math.ceil(bins.length / MAX_HISTOGRAM_BINS);
  const sampled: number[] = [];
  for (let index = 0; index < bins.length; index += groupSize) {
    sampled.push(bins.slice(index, index + groupSize).reduce((sum, value) => sum + value, 0));
  }
  return sampled.slice(0, MAX_HISTOGRAM_BINS);
};

const summarizeHistogram = (
  histogram: ReturnType<typeof useEditorStore.getState>['histogram'],
): AgentImageContextSnapshot['histogramSummary'] => {
  if (histogram === null) return [];

  return ([ActiveChannel.Red, ActiveChannel.Green, ActiveChannel.Blue, ActiveChannel.Luma] as const)
    .map((channel) => {
      const bins = getHistogramData(histogram[channel]);
      return {
        bins: downsampleBins(bins),
        channel,
        max: Math.max(...bins, 0),
        total: bins.reduce((sum, value) => sum + Math.max(value, 0), 0),
      };
    })
    .filter((entry) => entry.total > 0);
};

const summarizeClipping = (
  histogramSummary: AgentImageContextSnapshot['histogramSummary'],
): AgentImageContextSnapshot['clipping'] => {
  let highlightsPercent = 0;
  let shadowsPercent = 0;

  for (const channel of histogramSummary) {
    if (channel.total <= 0) continue;
    shadowsPercent = Math.max(shadowsPercent, ((channel.bins[0] ?? 0) / channel.total) * 100);
    highlightsPercent = Math.max(highlightsPercent, ((channel.bins.at(-1) ?? 0) / channel.total) * 100);
  }

  return {
    highlightsPercent: Number(highlightsPercent.toFixed(3)),
    shadowsPercent: Number(shadowsPercent.toFixed(3)),
  };
};

export const buildAgentImageContextSnapshot = (): AgentImageContextSnapshot => {
  const editor = useEditorStore.getState();
  if (editor.selectedImage === null) {
    throw new Error('Cannot build agent image context without a selected image.');
  }

  const histogramSummary = summarizeHistogram(editor.histogram);

  return agentImageContextSnapshotSchema.parse({
    activeImagePath: editor.selectedImage.path,
    adjustmentSummary: summarizeAdjustment(editor.adjustments),
    clipping: summarizeClipping(histogramSummary),
    cropHint: { active: editor.adjustments.crop !== null, aspectRatio: editor.adjustments.aspectRatio },
    graphRevision: `history_${editor.historyIndex}`,
    histogramSummary,
    metadataSummary: summarizeMetadata(editor.selectedImage.exif ?? undefined),
    previewIdentity: editor.finalPreviewUrl,
    subjectHint: {
      hasActiveMask: editor.activeMaskContainerId !== null,
      maskCount: editor.adjustments.masks.length,
    },
  });
};
