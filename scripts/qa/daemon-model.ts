import { z } from 'zod';

export interface QaDaemonIdentity {
  worktree: string;
  configuration: string;
  source: string;
  headed: boolean;
}

export interface QaDaemonMetrics {
  serverStarts: number;
  browserStarts: number;
  sourceReuses: number;
  configurationRestarts: number;
  jobs: number;
  contextsCreated: number;
  contextsClosed: number;
  leakedContexts: number;
}

export type QaDaemonRequest =
  | { id: string; method: 'health' }
  | { id: string; method: 'shutdown' }
  | {
      id: string;
      method: 'run';
      identity: QaDaemonIdentity;
      scenarioIds: string[];
      shard: { index: number; total: number };
    };

export interface QaDaemonResponse {
  id: string;
  ok: boolean;
  result?: unknown | undefined;
  error?: string | undefined;
}

export interface QaDaemonStateRecord {
  schemaVersion: 1;
  pid: number;
  worktree: string;
  socketPath: string;
  startedAt: string;
  processStartToken: string;
}

const identitySchema = z.object({
  worktree: z.string().min(1),
  configuration: z.string().length(64),
  source: z.string().length(64),
  headed: z.boolean(),
});

export const qaDaemonRequestSchema: z.ZodType<QaDaemonRequest> = z.discriminatedUnion('method', [
  z.object({ id: z.string().min(1), method: z.literal('health') }),
  z.object({ id: z.string().min(1), method: z.literal('shutdown') }),
  z.object({
    id: z.string().min(1),
    method: z.literal('run'),
    identity: identitySchema,
    scenarioIds: z.array(z.string().min(1)),
    shard: z.object({ index: z.number().int().nonnegative(), total: z.number().int().positive() }),
  }),
]);

export const qaDaemonResponseSchema: z.ZodType<QaDaemonResponse> = z.object({
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export const qaDaemonStateSchema: z.ZodType<QaDaemonStateRecord> = z.object({
  schemaVersion: z.literal(1),
  pid: z.number().int().positive(),
  worktree: z.string().min(1),
  socketPath: z.string().min(1),
  startedAt: z.string().min(1),
  processStartToken: z.string().min(1),
});

export const qaDaemonMetricsSchema: z.ZodType<QaDaemonMetrics> = z.object({
  serverStarts: z.number().int().nonnegative(),
  browserStarts: z.number().int().nonnegative(),
  sourceReuses: z.number().int().nonnegative(),
  configurationRestarts: z.number().int().nonnegative(),
  jobs: z.number().int().nonnegative(),
  contextsCreated: z.number().int().nonnegative(),
  contextsClosed: z.number().int().nonnegative(),
  leakedContexts: z.number().int().nonnegative(),
});
