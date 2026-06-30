import { z } from 'zod';

export const hdrPerformanceResultSchema = z
  .object({
    budgetMs: z.number().int().positive(),
    elapsedMs: z.number().nonnegative(),
    id: z.enum(['alignment-smoke', 'deghosting-smoke', 'merge-weighting-smoke']),
    status: z.enum(['pass', 'fail']),
  })
  .strict();

export const hdrPerformanceReportSchema = z
  .object({
    issue: z.literal(173),
    results: z.array(hdrPerformanceResultSchema).length(3),
    runtimeStatus: z.literal('synthetic_performance_smoke'),
    schemaVersion: z.literal(1),
    totalElapsedMs: z.number().nonnegative(),
  })
  .strict()
  .superRefine((report, context) => {
    for (const [index, result] of report.results.entries()) {
      if (result.status !== 'pass' || result.elapsedMs > result.budgetMs) {
        context.addIssue({
          code: 'custom',
          message: `${result.id} exceeded HDR performance budget.`,
          path: ['results', index],
        });
      }
    }
  });

export type HdrPerformanceReport = z.infer<typeof hdrPerformanceReportSchema>;

export const parseHdrPerformanceReport = (value: unknown): HdrPerformanceReport =>
  hdrPerformanceReportSchema.parse(value);
