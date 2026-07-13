import { z } from 'zod';

export const nativeFeedbackProfileSchema = z.object({
  id: z.enum(['dev-baseline', 'rapid-dev-fast', 'rapid-dev-perf']),
  cargoProfile: z.enum(['dev', 'rapid-dev-fast', 'rapid-dev-perf']),
  purpose: z.enum(['baseline', 'edit-to-test', 'performance-representative']),
  optLevel: z.number().int().min(0).max(3),
  debugInfo: z.number().int().min(0).max(2),
  rustFlags: z.array(z.string()).default([]),
  codegenUnits: z.number().int().positive(),
  incremental: z.literal(true),
});

export type NativeFeedbackProfile = z.infer<typeof nativeFeedbackProfileSchema>;

export const nativeFeedbackProfiles: readonly NativeFeedbackProfile[] = [
  {
    id: 'dev-baseline',
    cargoProfile: 'dev',
    purpose: 'baseline',
    optLevel: 2,
    debugInfo: 1,
    rustFlags: [],
    codegenUnits: 256,
    incremental: true,
  },
  {
    id: 'rapid-dev-fast',
    cargoProfile: 'rapid-dev-fast',
    purpose: 'edit-to-test',
    optLevel: 0,
    debugInfo: 0,
    rustFlags: ['-Cprefer-dynamic'],
    codegenUnits: 256,
    incremental: true,
  },
  {
    id: 'rapid-dev-perf',
    cargoProfile: 'rapid-dev-perf',
    purpose: 'performance-representative',
    optLevel: 2,
    debugInfo: 1,
    rustFlags: [],
    codegenUnits: 64,
    incremental: true,
  },
] as const;

export const nativeFeedbackSampleSchema = z.object({
  scenario: z.enum(['clean', 'noop', 'leaf-edit', 'core-edit']),
  iteration: z.number().int().nonnegative(),
  wallMs: z.number().nonnegative(),
  criticalPathMs: z.number().nonnegative(),
  rebuiltCrates: z.number().int().nonnegative(),
  linkMs: z.number().nonnegative(),
  peakRssBytes: z.number().int().nonnegative(),
  artifactBytes: z.number().int().nonnegative(),
  timeToTestMs: z.number().nonnegative(),
  status: z.literal('valid'),
  measurement: z.object({
    kind: z.literal('cargo-runtime'),
    command: z.array(z.string().min(1)).min(2),
    timingReportDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    exitCode: z.literal(0),
  }),
});

const distributionSchema = z.object({
  median: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  samples: z.number().int().positive(),
});

export const nativeFeedbackReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  profile: nativeFeedbackProfileSchema,
  identity: z.object({
    gitCommit: z.string().regex(/^[0-9a-f]{40}$/u),
    dirtyDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    cargoLockDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    workspaceManifestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    rustc: z.string().min(1),
    cargo: z.string().min(1),
    hardwareClass: z.string().min(1),
  }),
  protocol: z.object({ warmupRuns: z.number().int().nonnegative(), measuredRuns: z.number().int().positive() }),
  samples: z.array(nativeFeedbackSampleSchema).min(4),
  summary: z.record(
    z.enum(['clean', 'noop', 'leaf-edit', 'core-edit']),
    z.object({ wallMs: distributionSchema, timeToTestMs: distributionSchema }),
  ),
  status: z.literal('pass'),
  integrations: z.object({
    performanceArtifact: z.object({
      schemaVersion: z.literal(1),
      kind: z.literal('performance-run-adapter'),
      scenarioId: z.string().min(1),
      hardwareClass: z.string().min(1),
      rawSampleCount: z.number().int().positive(),
      metricNames: z.array(z.string().min(1)).min(1),
      retentionDays: z.number().int().positive(),
    }),
    validationNode: z.object({
      schemaVersion: z.literal(1),
      kind: z.literal('validation-node-result'),
      nodeId: z.string().min(1),
      cacheKey: z.string().regex(/^[0-9a-f]{64}$/u),
    }),
  }),
  rerunCommand: z.string().min(1),
});

export type NativeFeedbackReceipt = z.infer<typeof nativeFeedbackReceiptSchema>;
export type NativeFeedbackSample = z.infer<typeof nativeFeedbackSampleSchema>;
