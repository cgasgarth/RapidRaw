import { z } from 'zod';

export const waveletWorkflowReportSchema = z
  .object({
    artifactPath: z.string().min(1),
    applyStatus: z.literal('applied'),
    disabledPreviewMaxDelta: z.literal(0),
    disabledRenderHash: z.string().regex(/^[0-9]+$/u),
    enabledRenderHash: z.string().regex(/^[0-9]+$/u),
    inputToPreviewMaxDelta: z.number().positive(),
    issue: z.literal(1266),
    mutates: z.literal(true),
    orderedAfter: z.literal('scene_linear_post_denoise'),
    orderedBefore: z.literal('capture_sharpen'),
    persistentAdjustments: z
      .object({
        waveletDetailCoarse: z.literal(0),
        waveletDetailEdgeThreshold: z.literal(0.28),
        waveletDetailEnabled: z.literal(true),
        waveletDetailFine: z.literal(55),
        waveletDetailHaloSuppression: z.literal(0.8),
        waveletDetailMedium: z.literal(35),
      })
      .strict(),
    previewToExportMaxDelta: z.literal(0),
    runtimeStatus: z.literal('preview_export_parity'),
    schemaVersion: z.literal(1),
    stage: z.literal('wavelet_luma_detail'),
    warnings: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.enabledRenderHash === report.disabledRenderHash) {
      context.addIssue({
        code: 'custom',
        message: 'Enabled and disabled render hashes must differ.',
        path: ['enabledRenderHash'],
      });
    }
  });

export type WaveletWorkflowReport = z.infer<typeof waveletWorkflowReportSchema>;

export const parseWaveletWorkflowReport = (value: unknown): WaveletWorkflowReport =>
  waveletWorkflowReportSchema.parse(value);
