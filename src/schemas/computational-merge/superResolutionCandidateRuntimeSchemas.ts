import { z } from 'zod';

const progressSchema = z
  .object({
    schemaVersion: z.number().int(),
    jobId: z.string(),
    family: z.literal('super_resolution'),
    stage: z.string(),
    completedUnits: z.number().int(),
    totalUnits: z.number().int(),
    completedWeight: z.number().int(),
    totalWeight: z.number().int(),
    fraction: z.number(),
    status: z.enum(['active', 'cancel_requested', 'cancelled', 'failed', 'succeeded']),
  })
  .strict();

export const burstSrCandidateJobHandleSchema = z.object({ jobId: z.string(), status: z.literal('active') }).strict();
export const burstSrCandidateJobResultSchema = z
  .object({
    jobId: z.string(),
    status: z.enum(['active', 'cancel_requested', 'cancelled', 'failed', 'succeeded']),
    errorCode: z.string().nullable(),
    candidate: z
      .object({
        packageId: z.string(),
        manifestHandle: z.string(),
        candidateHash: z.string(),
        commitReady: z.boolean(),
        capabilityState: z.enum(['durable_commit_pending', 'review_required']),
        width: z.number().int(),
        height: z.number().int(),
        tileCount: z.number().int(),
        observedPeakMemoryBytes: z.number().int(),
        memoryBudgetBytes: z.number().int(),
        qualityDecision: z.enum(['commit_ready', 'review_required']),
      })
      .strict()
      .nullable(),
    progress: progressSchema,
  })
  .strict();
export type BurstSrCandidateJobResult = z.infer<typeof burstSrCandidateJobResultSchema>;
