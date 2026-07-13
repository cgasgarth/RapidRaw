import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { type BaselineHistory, verifyBaselineHistory } from './history';
import type { PerformanceRunReceipt } from './model';

const uploadFileSchema = z.object({
  bytes: z.number().int().nonnegative(),
  kind: z.enum(['run-receipt', 'regression-artifact', 'trend-gate', 'trace', 'log']),
  path: z.string().startsWith('/'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

export const performanceArtifactUploadManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  generatedAt: z.string().datetime(),
  hardwareClassId: z.string().regex(/^[0-9a-f]{64}$/u),
  status: z.enum(['pass', 'regression', 'invalid']),
  retention: z.object({ unapprovedDays: z.number().int().positive(), regressionDays: z.number().int().positive() }),
  files: z.array(uploadFileSchema).min(1),
});

export type PerformanceArtifactUploadManifest = z.infer<typeof performanceArtifactUploadManifestSchema>;

const artifactKind = (path: string): z.infer<typeof uploadFileSchema>['kind'] => {
  if (path.endsWith('.regression.json')) return 'regression-artifact';
  if (path.endsWith('-gate.json') || path.endsWith('trend-gate.json')) return 'trend-gate';
  if (path.endsWith('.trace.json')) return 'trace';
  if (path.endsWith('.log')) return 'log';
  return 'run-receipt';
};

export async function createPerformanceArtifactUploadManifest(options: {
  receipt: PerformanceRunReceipt;
  paths: readonly string[];
  generatedAt: string;
  retention?: { unapprovedDays: number; regressionDays: number } | undefined;
}): Promise<PerformanceArtifactUploadManifest> {
  const files = await Promise.all(
    [...new Set(options.paths.map((path) => resolve(path)))].sort().map(async (path) => {
      const bytes = await readFile(path);
      return {
        bytes: (await stat(path)).size,
        kind: artifactKind(path),
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  );
  return performanceArtifactUploadManifestSchema.parse({
    schemaVersion: 1,
    runId: options.receipt.runId,
    generatedAt: options.generatedAt,
    hardwareClassId: options.receipt.identity.hardware.classId,
    status: options.receipt.status,
    retention: options.retention ?? { unapprovedDays: 14, regressionDays: 30 },
    files,
  });
}

export const performanceArtifactIndexSchema = z.object({
  schemaVersion: z.literal(1),
  artifacts: z.array(
    z.object({
      createdAt: z.string().datetime(),
      path: z.string().startsWith('/'),
      runId: z.string().min(1),
      status: z.enum(['pass', 'regression', 'invalid']),
    }),
  ),
});

export function planPerformanceArtifactRetention(options: {
  history: BaselineHistory;
  index: z.infer<typeof performanceArtifactIndexSchema>;
  now: string;
  unapprovedDays?: number | undefined;
  regressionDays?: number | undefined;
}) {
  const approved = new Set(verifyBaselineHistory(options.history).entries.map(({ receipt }) => receipt.runId));
  const now = Date.parse(options.now);
  const unapprovedMs = (options.unapprovedDays ?? 14) * 86_400_000;
  const regressionMs = (options.regressionDays ?? 30) * 86_400_000;
  const keep: string[] = [];
  const pruneCandidates: string[] = [];
  for (const artifact of options.index.artifacts) {
    const age = now - Date.parse(artifact.createdAt);
    const expired = age > (artifact.status === 'regression' ? regressionMs : unapprovedMs);
    if (approved.has(artifact.runId) || !expired) keep.push(artifact.path);
    else pruneCandidates.push(artifact.path);
  }
  return {
    schemaVersion: 1 as const,
    policy: 'plan-only-approved-history-preserved' as const,
    approvedRunIds: [...approved].sort(),
    keep: keep.sort(),
    pruneCandidates: pruneCandidates.sort(),
  };
}
