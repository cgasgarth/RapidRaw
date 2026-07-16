#!/usr/bin/env bun

import { availableParallelism, totalmem } from 'node:os';

export const MAX_COVERAGE_FILES_PER_WORKER = 12;
export const COVERAGE_WORKER_MEMORY_BYTES = 192 * 1024 ** 2;
export const COVERAGE_MEMORY_RESERVE_BYTES = 512 * 1024 ** 2;
export const MAX_COVERAGE_WORKERS = 40;

export function resolveCoverageWorkerCount(testFileCount: number, cpuCount: number, memoryBytes: number): number {
  if (!Number.isSafeInteger(testFileCount) || testFileCount < 1)
    throw new Error(`invalid Bun coverage test file count: ${testFileCount}`);
  if (!Number.isSafeInteger(cpuCount) || cpuCount < 1) throw new Error(`invalid Bun coverage CPU count: ${cpuCount}`);
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes <= COVERAGE_MEMORY_RESERVE_BYTES)
    throw new Error(`insufficient memory for Bun coverage workers: ${memoryBytes}`);

  const requiredWorkers = Math.min(
    testFileCount,
    Math.max(cpuCount, Math.ceil(testFileCount / MAX_COVERAGE_FILES_PER_WORKER)),
  );
  const memoryWorkerCap = Math.floor((memoryBytes - COVERAGE_MEMORY_RESERVE_BYTES) / COVERAGE_WORKER_MEMORY_BYTES);
  const workerCap = Math.min(memoryWorkerCap, MAX_COVERAGE_WORKERS);
  if (workerCap < requiredWorkers) {
    throw new Error(
      `Bun coverage needs ${requiredWorkers} native workers for ${testFileCount} files, but memory safely permits ${workerCap}`,
    );
  }
  return requiredWorkers;
}

export async function countBunTestFiles(target: string): Promise<number> {
  const glob = new Bun.Glob('**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}');
  let count = 0;
  for await (const _path of glob.scan({ cwd: target, onlyFiles: true })) count += 1;
  return count;
}

export function buildCoverageTestArgs(workerCount: number, target: string): string[] {
  if (!Number.isSafeInteger(workerCount) || workerCount < 1)
    throw new Error(`invalid Bun coverage workers: ${workerCount}`);
  return ['test', '--no-orphans', '--dots', `--parallel=${workerCount}`, '--coverage', target];
}

if (import.meta.main) {
  const target = process.argv[2] ?? 'tests/pure-ts';
  const testFileCount = await countBunTestFiles(target);
  const workerCount = resolveCoverageWorkerCount(testFileCount, availableParallelism(), totalmem());
  console.log(
    `Bun coverage: ${testFileCount} files, ${workerCount} native workers, <=${MAX_COVERAGE_FILES_PER_WORKER} files/worker`,
  );
  const child = Bun.spawn(['bun', ...buildCoverageTestArgs(workerCount, target)], {
    env: process.env,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });
  process.exit(await child.exited);
}
