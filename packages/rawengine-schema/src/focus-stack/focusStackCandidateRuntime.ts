import { z } from 'zod';
import { computationalMergeProgressV1Schema } from '../computational-merge/computationalMergeFoundationSchemas.js';

export const focusStackCandidateHandleV1Schema = z
  .object({
    packageId: z.string().startsWith('focus-candidate-'),
    manifestHandle: z.string().startsWith('rawengine-cache://'),
    candidateHash: z.string().startsWith('blake3:'),
    commitReady: z.literal(true),
    capabilityState: z.literal('durable_commit_pending'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    tileCount: z.number().int().positive(),
    observedPeakMemoryBytes: z.number().int().nonnegative(),
    memoryBudgetBytes: z.number().int().positive(),
  })
  .strict();
export const focusStackCandidateJobHandleV1Schema = z
  .object({ jobId: z.string().uuid(), status: z.literal('active') })
  .strict();
export const focusStackCandidateJobResultV1Schema = z
  .object({
    jobId: z.string().uuid(),
    status: z.enum(['active', 'cancel_requested', 'cancelled', 'failed', 'succeeded']),
    errorCode: z.string().nullable(),
    candidate: focusStackCandidateHandleV1Schema.nullable(),
    progress: computationalMergeProgressV1Schema,
  })
  .strict();
export type FocusStackCandidateJobResultV1 = z.infer<typeof focusStackCandidateJobResultV1Schema>;
