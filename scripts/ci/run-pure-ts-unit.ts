#!/usr/bin/env bun

import { readdir, readFile, stat } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

import { formatCommandForLog, readBoundedStream } from '../lib/ci/compact-output.ts';

const DEFAULT_SHARD_COUNT = 8;
const DEFAULT_WORKERS_PER_SHARD = 2;
const DEFAULT_SHARD_TIMEOUT_MS = 120_000;
const MAX_CONCURRENT_WORKERS = 8;
const MEMORY_BYTES_PER_WORKER = 2 * 1024 * 1024 * 1024;
const TEST_FILE_PATTERN = /\.test\.[cm]?[jt]sx?$/u;

export const EXCLUSIVE_PURE_TS_TEST_FILES = [
  'tests/pure-ts/app/app-render-isolation.test.tsx',
  'tests/pure-ts/ci/resource-coordinator.test.ts',
  'tests/pure-ts/performance-lab-history.test.ts',
  'tests/pure-ts/performance-lab.test.ts',
  'tests/pure-ts/qa-daemon.test.ts',
] as const;

export interface PureTsHostCapacity {
  cpuCores: number;
  memoryBytes: number;
}

export interface PureTsUnitPlan {
  effectiveCpuCores: number;
  effectiveMemoryBytes: number;
  maxConcurrentWorkers: number;
  parallelShardCount: number;
  workersPerShard: number;
}

export interface PureTsUnitShardResult {
  command: string[];
  durationMs: number;
  exitCode: number;
  pid: number;
  shard: number;
  lane: 'exclusive' | 'parallel';
  parallelWidth: number;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  workersPerShard: number;
}

export interface PureTsUnitOptions {
  capacity?: PureTsHostCapacity;
  cwd?: string;
  env?: Record<string, string | undefined>;
  exclusiveFiles?: readonly string[];
  shardCount?: number;
  shardTimeoutMs?: number;
  target?: string;
  workersPerShard?: number;
}

interface NormalizedPureTsUnitOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shardTimeoutMs: number;
  workersPerShard: number;
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

const normalizePath = (path: string): string => path.split(sep).join('/');

const parseBoundedInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '' || value.trim() === 'max') return undefined;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export const resolvePureTsHostCapacity = (input: {
  cgroupCpuMax?: string;
  cgroupCpuPeriodMicros?: string;
  cgroupCpuQuotaMicros?: string;
  cgroupMemoryLimitBytes?: string;
  cgroupMemoryMax?: string;
  hostCpuCores: number;
  hostMemoryBytes: number;
}): PureTsHostCapacity => {
  const hostCpuCores = positiveInteger(Math.floor(input.hostCpuCores), 'hostCpuCores');
  const hostMemoryBytes = positiveInteger(Math.floor(input.hostMemoryBytes), 'hostMemoryBytes');
  const cpuMaxParts = input.cgroupCpuMax?.trim().split(/\s+/u);
  const v2Quota = parseBoundedInteger(cpuMaxParts?.[0]);
  const v2Period = parseBoundedInteger(cpuMaxParts?.[1]);
  const v1Quota = parseBoundedInteger(input.cgroupCpuQuotaMicros);
  const v1Period = parseBoundedInteger(input.cgroupCpuPeriodMicros);
  const quota = input.cgroupCpuMax === undefined ? v1Quota : v2Quota;
  const period = input.cgroupCpuMax === undefined ? v1Period : v2Period;
  const quotaCores = quota === undefined || period === undefined ? undefined : Math.max(1, Math.floor(quota / period));
  const memoryLimit =
    input.cgroupMemoryMax === undefined
      ? parseBoundedInteger(input.cgroupMemoryLimitBytes)
      : parseBoundedInteger(input.cgroupMemoryMax);
  return {
    cpuCores: Math.min(hostCpuCores, quotaCores ?? hostCpuCores),
    memoryBytes: Math.min(hostMemoryBytes, memoryLimit ?? hostMemoryBytes),
  };
};

const readOptional = async (path: string): Promise<string | undefined> =>
  await readFile(path, 'utf8').catch(() => undefined);

export const detectPureTsHostCapacity = async (): Promise<PureTsHostCapacity> =>
  resolvePureTsHostCapacity({
    cgroupCpuMax: await readOptional('/sys/fs/cgroup/cpu.max'),
    cgroupCpuPeriodMicros: await readOptional('/sys/fs/cgroup/cpu/cpu.cfs_period_us'),
    cgroupCpuQuotaMicros: await readOptional('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'),
    cgroupMemoryLimitBytes: await readOptional('/sys/fs/cgroup/memory/memory.limit_in_bytes'),
    cgroupMemoryMax: await readOptional('/sys/fs/cgroup/memory.max'),
    hostCpuCores: availableParallelism(),
    hostMemoryBytes: totalmem(),
  });

export const planPureTsUnitConcurrency = (input: {
  capacity: PureTsHostCapacity;
  fileCount: number;
  requestedShardCount?: number;
  requestedWorkersPerShard?: number;
}): PureTsUnitPlan => {
  const effectiveCpuCores = positiveInteger(Math.floor(input.capacity.cpuCores), 'capacity.cpuCores');
  const effectiveMemoryBytes = positiveInteger(Math.floor(input.capacity.memoryBytes), 'capacity.memoryBytes');
  const fileCount = Math.max(0, Math.floor(input.fileCount));
  const memoryWorkers = Math.max(1, Math.floor(effectiveMemoryBytes / MEMORY_BYTES_PER_WORKER));
  const maxConcurrentWorkers = Math.min(MAX_CONCURRENT_WORKERS, effectiveCpuCores, memoryWorkers);
  const requestedShards = positiveInteger(input.requestedShardCount ?? DEFAULT_SHARD_COUNT, 'shardCount');
  const parallelShardCount = Math.min(fileCount, requestedShards, maxConcurrentWorkers);
  const requestedWorkers = positiveInteger(
    input.requestedWorkersPerShard ?? DEFAULT_WORKERS_PER_SHARD,
    'workersPerShard',
  );
  const workersPerShard =
    parallelShardCount === 0
      ? 1
      : Math.min(requestedWorkers, Math.max(1, Math.floor(maxConcurrentWorkers / parallelShardCount)));
  return {
    effectiveCpuCores,
    effectiveMemoryBytes,
    maxConcurrentWorkers,
    parallelShardCount,
    workersPerShard,
  };
};

const discoverTestFiles = async (target: string): Promise<string[]> => {
  const targetStat = await stat(target);
  if (targetStat.isFile()) return TEST_FILE_PATTERN.test(target) ? [resolve(target)] : [];
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) files.push(path);
      }),
    );
  };
  await visit(target);
  return files.sort((left, right) => left.localeCompare(right));
};

const partitionFiles = (files: readonly string[], count: number): string[][] => {
  const partitions = Array.from({ length: count }, () => [] as string[]);
  files.forEach((file, index) => partitions[index % count]?.push(file));
  return partitions;
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
  options: NormalizedPureTsUnitOptions,
  files: readonly string[],
  lane: PureTsUnitShardResult['lane'],
  parallelWidth: number,
  shard: number,
) => {
  const command = [
    'bun',
    'test',
    '--no-orphans',
    '--isolate',
    '--reporter=dot',
    `--parallel=${String(options.workersPerShard)}`,
    ...files,
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
    lane,
    parallelWidth,
    stderr,
    stdout,
    timedOut,
    workersPerShard: options.workersPerShard,
  } satisfies PureTsUnitShardResult;
};

export const runPureTsUnitShards = async (options: PureTsUnitOptions = {}): Promise<PureTsUnitShardResult[]> => {
  const cwd = options.cwd ?? process.cwd();
  const target = resolve(cwd, options.target ?? 'tests/pure-ts');
  const files = await discoverTestFiles(target);
  const exclusiveCandidates = new Set(
    (options.exclusiveFiles ?? EXCLUSIVE_PURE_TS_TEST_FILES).map((path) => normalizePath(resolve(cwd, path))),
  );
  const exclusiveFiles = files.filter((path) => exclusiveCandidates.has(normalizePath(path)));
  const parallelFiles = files.filter((path) => !exclusiveCandidates.has(normalizePath(path)));
  const capacity = options.capacity ?? (await detectPureTsHostCapacity());
  const plan = planPureTsUnitConcurrency({
    capacity,
    fileCount: parallelFiles.length,
    requestedShardCount: options.shardCount,
    requestedWorkersPerShard: options.workersPerShard,
  });
  const normalized: NormalizedPureTsUnitOptions = {
    cwd,
    env: { ...process.env, ...options.env },
    shardTimeoutMs: positiveInteger(options.shardTimeoutMs ?? DEFAULT_SHARD_TIMEOUT_MS, 'shardTimeoutMs'),
    workersPerShard: plan.workersPerShard,
  };
  const partitions = partitionFiles(parallelFiles, plan.parallelShardCount).map((partition) =>
    partition.map((path) => normalizePath(relative(cwd, path))),
  );
  const parallelResults = await Promise.all(
    partitions.map((partition, index) => runShard(normalized, partition, 'parallel', partitions.length, index + 1)),
  );
  const results = [...parallelResults];
  for (const path of exclusiveFiles) {
    const exclusiveOptions = { ...normalized, workersPerShard: 1 };
    results.push(
      await runShard(exclusiveOptions, [normalizePath(relative(cwd, path))], 'exclusive', 1, results.length + 1),
    );
  }
  return results;
};

const summarizeCompletedSuite = (results: readonly PureTsUnitShardResult[]): string => {
  let tests = 0;
  let files = 0;
  for (const result of results) {
    const summary = `${result.stdout}\n${result.stderr}`.match(/Ran (\d+) tests? across (\d+) files?\./u);
    tests += Number(summary?.[1] ?? 0);
    files += Number(summary?.[2] ?? 0);
  }
  const durationMs = Math.max(0, ...results.map(({ durationMs }) => durationMs));
  const workerCount = Math.max(
    0,
    ...results.map(({ lane, parallelWidth, workersPerShard }) =>
      lane === 'parallel' ? parallelWidth * workersPerShard : 1,
    ),
  );
  const exclusiveCount = results.filter(({ lane }) => lane === 'exclusive').length;
  const parallelCount = results.filter(({ lane }) => lane === 'parallel').length;
  return `pure-ts unit ok (${String(tests)} tests, ${String(files)} files, ${String(parallelCount)} shards/${String(workerCount)} concurrent workers + ${String(exclusiveCount)} exclusive, ${String(durationMs)}ms)`;
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
