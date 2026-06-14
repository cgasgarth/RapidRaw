import { z } from 'zod';

export const exportQueueJobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const exportQueuePrioritySchema = z.enum(['normal', 'high']);

export const exportQueueRecipeRefSchema = z
  .object({
    fileFormat: z.enum(['jpeg', 'png', 'tiff', 'webp', 'jxl', 'avif', 'cube']),
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

export type ExportQueue = z.infer<typeof exportQueueSchema>;
export type ExportQueueJob = z.infer<typeof exportQueueJobSchema>;

export const parseExportQueue = (value: unknown): ExportQueue => exportQueueSchema.parse(value);
export const parseExportQueueJob = (value: unknown): ExportQueueJob => exportQueueJobSchema.parse(value);
