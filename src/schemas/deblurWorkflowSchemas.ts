import { z } from 'zod';

export const deblurWorkflowReportSchema = z
  .object({
    artifactPath: z.string().min(1),
    applyStatus: z.literal('applied'),
    disabledPreviewMaxDelta: z.literal(0),
    disabledRenderHash: z.string().regex(/^[0-9]+$/u),
    enabledRenderHash: z.string().regex(/^[0-9]+$/u),
    inputToPreviewMaxDelta: z.number().positive(),
    issue: z.literal(1183),
    orderedAfter: z.literal('scene_linear_denoise'),
    orderedBefore: z.literal('capture_sharpen'),
    persistentAdjustments: z
      .object({
        deblurEnabled: z.literal(true),
        deblurSigmaPx: z.literal(0.8),
        deblurStrength: z.literal(70),
      })
      .strict(),
    previewToExportMaxDelta: z.literal(0),
    runtimeStatus: z.literal('preview_export_parity'),
    schemaVersion: z.literal(1),
    stage: z.literal('scene_linear_post_denoise'),
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

export type DeblurWorkflowReport = z.infer<typeof deblurWorkflowReportSchema>;

export const parseDeblurWorkflowReport = (value: unknown): DeblurWorkflowReport =>
  deblurWorkflowReportSchema.parse(value);
