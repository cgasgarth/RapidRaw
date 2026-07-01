import { z } from 'zod';

import { hashLayerMaskStableJson } from './layerMaskProvenance';

export const layerMaskExportParityReceiptSchema = z
  .object({
    changedPixelRatio: z.number().gt(0),
    exportArtifactPath: z.string().regex(/^private-artifacts\//u),
    finalExportHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    fixtureId: z.literal('validation.layer-mask-real-raw.alaska-local-adjustment.v1'),
    metricCount: z.number().int().min(5),
    parityMetric: z.literal('previewExportMeanAbsDelta'),
    parityStatus: z.enum(['matched', 'mismatch', 'stale_blocked']),
    parityThreshold: z.number().gt(0),
    parityValue: z.number().min(0),
    receiptId: z.string().regex(/^layer_mask_export_parity_/u),
    receiptVersion: z.literal(1),
    refinedMaskContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    refinedPreviewArtifactPath: z.string().regex(/^private-artifacts\//u),
    refinedPreviewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    sourceContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    sourceGraphRevision: z.string().min(1),
    sourcePath: z.literal('private-fixtures/layers/alaska-layer-mask-v1.arw'),
    staleReasons: z.array(
      z.enum(['source_graph_revision_changed', 'source_content_hash_changed', 'mask_alpha_changed']),
    ),
    staleState: z.enum(['current', 'stale']),
    trackingIssue: z.literal(4558),
    unmaskedPreviewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    unrefinedPreviewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.parityStatus === 'matched' && receipt.staleState !== 'current') {
      context.addIssue({
        code: 'custom',
        message: 'Matched layer mask export parity requires current source and mask state.',
        path: ['parityStatus'],
      });
    }
    if (receipt.parityStatus === 'matched' && receipt.parityValue > receipt.parityThreshold) {
      context.addIssue({
        code: 'custom',
        message: 'Matched layer mask export parity exceeded the deterministic delta threshold.',
        path: ['parityValue'],
      });
    }
    if (receipt.staleState === 'stale' && receipt.staleReasons.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Stale layer mask export parity receipts require at least one stale reason.',
        path: ['staleReasons'],
      });
    }
    if (receipt.staleState === 'current' && receipt.staleReasons.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Current layer mask export parity receipts must not carry stale reasons.',
        path: ['staleReasons'],
      });
    }
    if (receipt.refinedPreviewHash === receipt.unmaskedPreviewHash) {
      context.addIssue({
        code: 'custom',
        message: 'Refined layer mask preview hash must differ from the unmasked preview hash.',
        path: ['refinedPreviewHash'],
      });
    }
    if (receipt.refinedPreviewHash === receipt.unrefinedPreviewHash) {
      context.addIssue({
        code: 'custom',
        message: 'Refined layer mask preview hash must differ from the unrefined mask preview hash.',
        path: ['refinedPreviewHash'],
      });
    }
  });

export type LayerMaskExportParityReceipt = z.infer<typeof layerMaskExportParityReceiptSchema>;

export const deriveLayerMaskExportParityReceiptState = ({
  current,
  receipt,
}: {
  current: LayerMaskExportParityReceipt;
  receipt: LayerMaskExportParityReceipt;
}): LayerMaskExportParityReceipt => {
  const staleReasons = [
    ...(receipt.sourceGraphRevision === current.sourceGraphRevision ? [] : ['source_graph_revision_changed' as const]),
    ...(receipt.sourceContentHash === current.sourceContentHash ? [] : ['source_content_hash_changed' as const]),
    ...(receipt.refinedMaskContentHash === current.refinedMaskContentHash ? [] : ['mask_alpha_changed' as const]),
  ];

  return layerMaskExportParityReceiptSchema.parse({
    ...receipt,
    parityStatus:
      staleReasons.length > 0
        ? 'stale_blocked'
        : receipt.parityValue <= receipt.parityThreshold
          ? 'matched'
          : 'mismatch',
    staleReasons,
    staleState: staleReasons.length > 0 ? 'stale' : 'current',
  });
};

export const buildLayerMaskExportParityReceiptId = (
  receipt: Pick<
    LayerMaskExportParityReceipt,
    'finalExportHash' | 'fixtureId' | 'refinedMaskContentHash' | 'refinedPreviewHash' | 'sourceGraphRevision'
  >,
): string => `layer_mask_export_parity_${hashLayerMaskStableJson(receipt).replace(':', '_')}`;
