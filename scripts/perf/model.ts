import { z } from 'zod';

export const metricSampleSchema = z.object({
  metric: z.string().min(1),
  run: z.number().int().nonnegative(),
  value: z.number().finite().nonnegative(),
  unit: z.enum(['ms', 'bytes', 'count', 'per-second']),
});

export const performanceIdentitySchema = z.object({
  git: z.object({
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    dirtyDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
  build: z.object({ profile: z.string().min(1), runtime: z.string().min(1) }),
  hardware: z.object({
    classId: z.string().regex(/^[0-9a-f]{64}$/u),
    cpuCores: z.number().int().positive(),
    cpuModelHash: z.string().regex(/^[0-9a-f]{64}$/u),
    memoryGiB: z.number().int().positive(),
  }),
  environment: z.object({ arch: z.string().min(1), bun: z.string().min(1), os: z.string().min(1) }),
});

export const metricSummarySchema = z.object({
  mad: z.number().nonnegative(),
  median: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  samples: z.number().int().positive(),
});

export const metricComparisonSchema = z.object({
  absoluteDelta: z.number().finite(),
  baseline: metricSummarySchema,
  candidate: metricSummarySchema,
  metric: z.string().min(1),
  regressed: z.boolean(),
  relativeDelta: z.number().finite(),
  threshold: z.object({ absolute: z.number().nonnegative(), relative: z.number().nonnegative() }),
});

export const performanceRunReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    scenario: z.object({
      id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u),
      version: z.number().int().positive(),
      fixtureDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
      cacheMode: z.enum(['cold', 'warm']),
    }),
    identity: performanceIdentitySchema,
    protocol: z.object({ warmupRuns: z.number().int().nonnegative(), measuredRuns: z.number().int().positive() }),
    samples: z.array(metricSampleSchema),
    correctness: z.object({ assertions: z.number().int().nonnegative(), passed: z.boolean() }),
    comparison: z.array(metricComparisonSchema),
    status: z.enum(['pass', 'regression', 'invalid']),
    invalidReason: z.string().min(1).optional(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    rerunCommand: z.string().min(1),
  })
  .superRefine((receipt, context) => {
    if (receipt.status !== 'invalid' && (receipt.samples.length === 0 || !receipt.correctness.passed))
      context.addIssue({ code: 'custom', message: 'Valid performance runs require samples and correctness proof.' });
    if (receipt.status === 'invalid' && receipt.invalidReason === undefined)
      context.addIssue({ code: 'custom', message: 'Invalid performance runs require a reason.' });
  });

export type PerformanceIdentity = z.infer<typeof performanceIdentitySchema>;
export type PerformanceRunReceipt = z.infer<typeof performanceRunReceiptSchema>;
export type MetricSample = z.infer<typeof metricSampleSchema>;

export interface PerformanceScenario {
  id: string;
  version: number;
  fixtureDigest: `sha256:${string}`;
  cacheMode: 'cold' | 'warm';
  warmupRuns: number;
  measuredRuns: number;
  budgets: Readonly<Record<string, { absolute: number; relative: number }>>;
  maxRelativeMad: number;
  metricUnits: Readonly<Record<string, MetricSample['unit']>>;
  runSample(run: number): Promise<{ assertions: number; metrics: Readonly<Record<string, number>> }>;
}
