import { z } from 'zod';

export const BATCH_AUTO_ADJUST_CONTRACT_V1 = 'rapidraw.batch_auto_adjust.v1' as const;

const acceptedPathReceiptSchema = z
  .object({
    baseAdjustmentDocumentRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    adjustmentDocumentRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    adjustments: z.record(z.string(), z.unknown()),
    engine: z.literal('rapidraw.legacy_auto_adjust.v1'),
    renderFingerprint: z.string().regex(/^u64:[0-9a-f]{16}$/u),
    sourceIdentity: z.string().min(1),
    sourceRevision: z.string().startsWith('source-revision-v1:'),
    thumbnailRevision: z.string().min(1),
    transactionId: z.string().startsWith('blake3:'),
  })
  .strict();

const acceptedPathResultSchema = z
  .object({
    contract: z.literal(BATCH_AUTO_ADJUST_CONTRACT_V1),
    path: z.string().min(1),
    receipt: acceptedPathReceiptSchema,
    status: z.enum(['applied', 'no_op', 'prepared']),
  })
  .strict();

const failedPathResultSchema = z
  .object({
    contract: z.literal(BATCH_AUTO_ADJUST_CONTRACT_V1),
    errorCode: z.string().min(1),
    errorMessage: z.string().min(1),
    path: z.string().min(1),
    status: z.literal('failed'),
  })
  .strict();

export const batchAutoAdjustPathResultV1Schema = z.discriminatedUnion('status', [
  acceptedPathResultSchema,
  failedPathResultSchema,
]);

export const batchAutoAdjustResultV1Schema = z.array(batchAutoAdjustPathResultV1Schema);

export const batchAutoAdjustPersistenceBarrierReceiptSchema = z
  .object({
    path: z.string().min(1),
    sidecarRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .passthrough();

export type BatchAutoAdjustPathResultV1 = z.infer<typeof batchAutoAdjustPathResultV1Schema>;
export type BatchAutoAdjustResultV1 = z.infer<typeof batchAutoAdjustResultV1Schema>;
