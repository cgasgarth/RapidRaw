#!/usr/bin/env bun

import { performance } from 'node:perf_hooks';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../lib/ci/compact-output.ts';

const DEFAULT_SHARD_COUNT = 8;
const DEFAULT_WORKERS_PER_SHARD = 2;
const DEFAULT_SHARD_TIMEOUT_MS = 120_000;

export interface PureTsUnitShardResult {
  command: string[];
  durationMs: number;
  exitCode: number;
  pid: number;
  shard: number;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

export interface PureTsUnitOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  shardCount?: number;
  shardTimeoutMs?: number;
  target?: string;
  workersPerShard?: number;
}

const FAILURE_ANCHOR = /(?:^error:|^\(fail\)|\.test\.[cm]?[jt]sx?:\d+|panic)/u;

export const selectPureTsFailureContext = (output: string): string => {
  const lines = output.split(/\r?\n/u);
  const selected = new Set<number>();
  for (const [index, line] of lines.entries()) {
    if (!FAILURE_ANCHOR.test(line)) continue;
    for (let context = Math.max(0, index - 8); context <= Math.min(lines.length - 1, index + 12); context += 1)
      selected.add(context);
  }
  if (selected.size === 0) return output;
  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => lines[index])
    .join('\n');
};

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
};

const signalProcessGroup = (pid: number, signal: 'SIGTERM' | 'SIGKILL'): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The shard already exited.
    }
  }
};

const runShard = async (
  options: Required<Omit<PureTsUnitOptions, 'env'>> & { env: NodeJS.ProcessEnv },
  shard: number,
) => {
  const command = [
    'bun',
    'test',
    '--no-orphans',
    '--isolate',
    '--reporter=dot',
    `--parallel=${String(options.workersPerShard)}`,
    `--shard=${String(shard)}/${String(options.shardCount)}`,
    options.target,
  ];
  const startedAt = performance.now();
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    detached: true,
    env: options.env,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  let timedOut = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    signalProcessGroup(child.pid, 'SIGTERM');
    forceKill = setTimeout(() => signalProcessGroup(child.pid, 'SIGKILL'), 1_500);
    forceKill.unref();
  }, options.shardTimeoutMs);
  timeout.unref();
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    readBoundedStream(child.stdout),
    readBoundedStream(child.stderr),
  ]);
  clearTimeout(timeout);
  if (forceKill !== undefined) clearTimeout(forceKill);
  return {
    command,
    durationMs: Math.round(performance.now() - startedAt),
    exitCode,
    pid: child.pid,
    shard,
    stderr,
    stdout,
    timedOut,
  } satisfies PureTsUnitShardResult;
};

export const runPureTsUnitShards = async (options: PureTsUnitOptions = {}): Promise<PureTsUnitShardResult[]> => {
  const normalized = {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    shardCount: positiveInteger(options.shardCount ?? DEFAULT_SHARD_COUNT, 'shardCount'),
    shardTimeoutMs: positiveInteger(options.shardTimeoutMs ?? DEFAULT_SHARD_TIMEOUT_MS, 'shardTimeoutMs'),
    target: options.target ?? 'tests/pure-ts',
    workersPerShard: positiveInteger(options.workersPerShard ?? DEFAULT_WORKERS_PER_SHARD, 'workersPerShard'),
  };
  return await Promise.all(
    Array.from({ length: normalized.shardCount }, (_, index) => runShard(normalized, index + 1)),
  );
};

const summarizeCompletedSuite = (results: readonly PureTsUnitShardResult[]): string => {
  let tests = 0;
  let files = 0;
  for (const result of results) {
    const summary = `${result.stdout}\n${result.stderr}`.match(/Ran (\d+) tests across (\d+) files\./u);
    tests += Number(summary?.[1] ?? 0);
    files += Number(summary?.[2] ?? 0);
  }
  const durationMs = Math.max(0, ...results.map(({ durationMs }) => durationMs));
  const workerCount = results.length * DEFAULT_WORKERS_PER_SHARD;
  return `pure-ts unit ok (${String(tests)} tests, ${String(files)} files, ${String(results.length)} shards/${String(workerCount)} workers, ${String(durationMs)}ms)`;
};

if (import.meta.main) {
  const results = await runPureTsUnitShards();
  const failed = results.filter(({ exitCode }) => exitCode !== 0);
  if (failed.length === 0) {
    console.log(summarizeCompletedSuite(results));
    process.exit(0);
  }
  for (const result of failed) {
    const disposition = result.timedOut
      ? `timed out after ${String(result.durationMs)}ms`
      : `failed exit=${result.exitCode}`;
    console.error(`pure-ts shard ${String(result.shard)}/${String(results.length)} ${disposition}`);
    console.error(`$ ${formatCommandForLog(result.command[0], result.command.slice(1))}`);
    const diagnosticOptions = { headLines: 30, maxChars: 8_000, maxLines: 80, tailLines: 40 };
    writeBoundedOutput(
      `shard ${String(result.shard)} stdout`,
      selectPureTsFailureContext(result.stdout),
      diagnosticOptions,
    );
    writeBoundedOutput(
      `shard ${String(result.shard)} stderr`,
      selectPureTsFailureContext(result.stderr),
      diagnosticOptions,
    );
  }
  process.exit(1);
}
