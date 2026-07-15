#!/usr/bin/env bun

import { performance } from 'node:perf_hooks';

import { formatCommandForLog, readBoundedStream } from '../lib/ci/compact-output.ts';

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
  const anchor = lines.findIndex((line) => /^error:/u.test(line));
  const fallbackAnchor = anchor >= 0 ? anchor : lines.findIndex((line) => FAILURE_ANCHOR.test(line));
  if (fallbackAnchor < 0) {
    if (lines.length <= 16) return output;
    return [...lines.slice(0, 6), '[...]', ...lines.slice(-9)].join('\n');
  }
  return lines.slice(Math.max(0, fallbackAnchor - 6), Math.min(lines.length, fallbackAnchor + 10)).join('\n');
};

export const formatPureTsShardFailure = (result: PureTsUnitShardResult, shardCount: number): string => {
  const disposition = result.timedOut
    ? `timed out after ${String(result.durationMs)}ms`
    : `failed exit=${result.exitCode}`;
  const output = result.stderr.trim() === '' ? result.stdout : result.stderr;
  return [
    `pure-ts shard ${String(result.shard)}/${String(shardCount)} ${disposition}`,
    `$ ${formatCommandForLog(result.command[0], result.command.slice(1))}`,
    selectPureTsFailureContext(output).trimEnd(),
  ]
    .filter((line) => line !== '')
    .join('\n')
    .concat('\n');
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
    process.stderr.write(formatPureTsShardFailure(result, results.length));
  }
  process.exit(1);
}
