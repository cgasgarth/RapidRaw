import { z } from 'zod';
import { qaDaemonMetricsSchema } from './daemon-model';

const artifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['download', 'json-report', 'screenshot', 'terminal-assertion']),
  path: z.string().min(1).optional(),
});

const scenarioResultSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['passed', 'failed']),
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
  log: z.string().optional(),
  screenshot: z.string().min(1).optional(),
  trace: z.string().min(1).optional(),
  video: z.string().min(1).optional(),
  artifacts: z.array(artifactSchema).optional(),
});

export const qaRunReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    gitSha: z.string().regex(/^[0-9a-f]{40}$/u),
    worktree: z.string().startsWith('/'),
    dirtyDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    buildIdentity: z.string().min(1),
    browserVersion: z.string().min(1),
    platform: z.string().min(1),
    shard: z.object({ index: z.number().int().nonnegative(), total: z.number().int().positive() }),
    seed: z.number().int().min(0).max(0xffff_ffff),
    persistent: z.boolean(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    scenarios: z.array(scenarioResultSchema).min(1),
    metrics: qaDaemonMetricsSchema,
    rerunCommand: z.string().min(1),
  })
  .refine(({ shard }) => shard.index < shard.total, {
    message: 'QA receipt shard index must be less than total.',
    path: ['shard', 'index'],
  });

export type ParsedQaRunReceipt = z.infer<typeof qaRunReceiptSchema>;

export interface QaReproductionIdentity {
  buildIdentity: string;
  dirtyDigest: string;
  gitSha: string;
  platform: string;
  worktree: string;
}

export function assertQaReproductionIdentity(
  receipt: Pick<ParsedQaRunReceipt, keyof QaReproductionIdentity>,
  current: QaReproductionIdentity,
): void {
  const mismatches = (Object.keys(current) as Array<keyof QaReproductionIdentity>).filter(
    (field) => receipt[field] !== current[field],
  );
  if (mismatches.length > 0)
    throw new Error(
      `QA reproduction identity mismatch: ${mismatches.map((field) => `${field}=${current[field]} (receipt ${receipt[field]})`).join('; ')}`,
    );
}

export function buildQaRerunArgs(receipt: Pick<ParsedQaRunReceipt, 'persistent' | 'scenarios' | 'seed'>): string[] {
  const failed = receipt.scenarios.filter(({ status }) => status === 'failed');
  const scenarios = failed.length > 0 ? failed : receipt.scenarios;
  const ids = [...new Set(scenarios.map(({ id }) => id))];
  if (ids.length === 0) throw new Error('QA receipt has no scenarios to reproduce.');
  return [
    'run',
    '--seed',
    String(receipt.seed),
    ...(receipt.persistent ? ['--persistent'] : []),
    ...ids.flatMap((id) => ['--scenario', id]),
  ];
}

const quoteShellArgument = (argument: string): string => `'${argument.replaceAll("'", "'\\''")}'`;

export function buildQaRerunCommand(receipt: Pick<ParsedQaRunReceipt, 'persistent' | 'scenarios' | 'seed'>): string {
  return ['bun', 'qa', ...buildQaRerunArgs(receipt)].map(quoteShellArgument).join(' ');
}
