import { z } from 'zod';

export const denoiseOperationHandleSchema = z
  .object({
    imageGeneration: z.number().int().positive(),
    operationGeneration: z.number().int().positive(),
  })
  .strict();

export type DenoiseOperationHandle = z.infer<typeof denoiseOperationHandleSchema>;

export const denoiseOperationsMatch = (active: DenoiseOperationHandle | null, incoming: DenoiseOperationHandle) =>
  active?.imageGeneration === incoming.imageGeneration && active.operationGeneration === incoming.operationGeneration;

export const isCurrentDenoiseEvent = (
  state: { activeOperation: DenoiseOperationHandle | null; isOpen: boolean; isProcessing: boolean },
  incoming: DenoiseOperationHandle,
) => state.isOpen && state.isProcessing && denoiseOperationsMatch(state.activeOperation, incoming);

export const denoiseCancelReceiptSchema = z
  .object({
    cancelled: z.boolean(),
    imageGeneration: z.number().int().nonnegative(),
    operationGeneration: z.number().int().positive().nullable(),
  })
  .strict();

export const denoiseWorkflowReportSchema = z
  .object({
    artifactPath: z.string().min(1),
    applyStatus: z.literal('applied'),
    disabledPreviewMaxDelta: z.literal(0),
    disabledRenderHash: z.string().regex(/^[0-9]+$/u),
    enabledRenderHash: z.string().regex(/^[0-9]+$/u),
    inputToPreviewMaxDelta: z.number().positive(),
    issue: z.literal(1177),
    mutates: z.literal(true),
    orderedAfter: z.literal('demosaic'),
    orderedBefore: z.literal('scene_linear_deblur'),
    persistentAdjustments: z
      .object({
        colorNoiseReduction: z.literal(65),
        lumaNoiseReduction: z.literal(55),
      })
      .strict(),
    previewToExportMaxDelta: z.literal(0),
    runtimeStatus: z.literal('preview_export_parity'),
    schemaVersion: z.literal(1),
    stage: z.literal('scene_linear_denoise'),
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

export type DenoiseWorkflowReport = z.infer<typeof denoiseWorkflowReportSchema>;

export const parseDenoiseWorkflowReport = (value: unknown): DenoiseWorkflowReport =>
  denoiseWorkflowReportSchema.parse(value);
