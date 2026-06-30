import { z } from 'zod';

import { EXPORT_QUEUE_FILE_FORMAT_IDS } from '../utils/export/exportFormatIds';

export const exportQueueJobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const exportQueuePrioritySchema = z.enum(['normal', 'high']);
export type ExportQueuePriority = z.infer<typeof exportQueuePrioritySchema>;

export const exportQueueRecipeRefSchema = z
  .object({
    fileFormat: z.enum(EXPORT_QUEUE_FILE_FORMAT_IDS),
    recipeId: z.string().trim().min(1),
    recipeName: z.string().trim().min(1),
  })
  .strict();

export const exportQueueJobSchema = z
  .object({
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    errorMessage: z.string().trim().min(1).nullable(),
    id: z.string().trim().min(1),
    outputTarget: z.string().trim().min(1),
    priority: exportQueuePrioritySchema.default('normal'),
    progress: z
      .object({
        current: z.number().int().min(0),
        total: z.number().int().min(1),
      })
      .strict(),
    recipe: exportQueueRecipeRefSchema,
    sourcePaths: z.array(z.string().trim().min(1)).min(1),
    startedAt: z.iso.datetime().nullable(),
    status: exportQueueJobStatusSchema,
  })
  .strict()
  .superRefine((job, context) => {
    if (job.progress.current > job.progress.total) {
      context.addIssue({
        code: 'custom',
        message: 'Export queue progress current cannot exceed total.',
        path: ['progress', 'current'],
      });
    }

    if (job.status === 'running' && job.startedAt === null) {
      context.addIssue({
        code: 'custom',
        message: 'Running export queue jobs require startedAt.',
        path: ['startedAt'],
      });
    }

    if (
      (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') &&
      job.completedAt === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Terminal export queue jobs require completedAt.',
        path: ['completedAt'],
      });
    }

    if (job.status === 'failed' && job.errorMessage === null) {
      context.addIssue({
        code: 'custom',
        message: 'Failed export queue jobs require errorMessage.',
        path: ['errorMessage'],
      });
    }
  });

export const exportQueueSchema = z
  .object({
    activeJobId: z.string().trim().min(1).nullable(),
    jobs: z.array(exportQueueJobSchema),
    maxConcurrentJobs: z.number().int().min(1).max(8),
  })
  .strict()
  .superRefine((queue, context) => {
    const ids = new Set<string>();
    for (const [index, job] of queue.jobs.entries()) {
      if (ids.has(job.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate export queue job id: ${job.id}`,
          path: ['jobs', index, 'id'],
        });
      }
      ids.add(job.id);
    }

    if (queue.activeJobId !== null && !ids.has(queue.activeJobId)) {
      context.addIssue({
        code: 'custom',
        message: 'activeJobId must reference a job in the queue.',
        path: ['activeJobId'],
      });
    }
  });

export const exportQueueExecutionPlanSchema = z
  .object({
    activeJobIds: z.array(z.string().trim().min(1)),
    availableSlots: z.number().int().min(0),
    nextJobIds: z.array(z.string().trim().min(1)),
    queuedJobIds: z.array(z.string().trim().min(1)),
  })
  .strict();

export type ExportQueue = z.infer<typeof exportQueueSchema>;
export type ExportQueueExecutionPlan = z.infer<typeof exportQueueExecutionPlanSchema>;
export type ExportQueueJob = z.infer<typeof exportQueueJobSchema>;

export const parseExportQueue = (value: unknown): ExportQueue => exportQueueSchema.parse(value);
export const parseExportQueueJob = (value: unknown): ExportQueueJob => exportQueueJobSchema.parse(value);

const EXPORT_QUEUE_PRIORITY_WEIGHT: Record<ExportQueuePriority, number> = {
  high: 0,
  normal: 1,
};

const compareExportQueueJobs = (left: ExportQueueJob, right: ExportQueueJob) =>
  EXPORT_QUEUE_PRIORITY_WEIGHT[left.priority] - EXPORT_QUEUE_PRIORITY_WEIGHT[right.priority] ||
  left.createdAt.localeCompare(right.createdAt) ||
  left.id.localeCompare(right.id);

export const buildExportQueueExecutionPlan = (value: unknown): ExportQueueExecutionPlan => {
  const queue = parseExportQueue(value);
  const runningJobs = queue.jobs
    .filter((job) => job.status === 'running')
    .toSorted(
      (left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? '') || left.id.localeCompare(right.id),
    );
  const queuedJobs = queue.jobs.filter((job) => job.status === 'queued').toSorted(compareExportQueueJobs);
  const availableSlots = Math.max(0, queue.maxConcurrentJobs - runningJobs.length);

  return exportQueueExecutionPlanSchema.parse({
    activeJobIds: runningJobs.map((job) => job.id),
    availableSlots,
    nextJobIds: queuedJobs.slice(0, availableSlots).map((job) => job.id),
    queuedJobIds: queuedJobs.map((job) => job.id),
  });
};
