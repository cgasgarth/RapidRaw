#!/usr/bin/env bun

import process from 'node:process';

import { z } from 'zod';

export const DEFAULT_RANDOMIZED_TEST_TARGET = 'tests/pure-ts';
export const RANDOMIZED_SUITE_RUN_COUNT = 2;
export const DEFAULT_RANDOMIZED_PASS_TIMEOUT_MS = 180_000;

const explicitSeedSchema = z.coerce.number().int().min(0).max(0xffff_ffff);
const passTimeoutSchema = z.coerce.number().int().min(100).max(900_000);

export function resolveRandomizedPassTimeout(value: string | undefined): number {
  return value === undefined ? DEFAULT_RANDOMIZED_PASS_TIMEOUT_MS : passTimeoutSchema.parse(value);
}

export function resolveRandomizedTestSeed(value: string | undefined): number {
  if (value !== undefined && /^\d+$/u.test(value)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric <= 0xffff_ffff) return explicitSeedSchema.parse(numeric);
  }

  const input = value ?? crypto.randomUUID();
  let hash = 2_166_136_261;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function buildRandomizedTestArgs(seed: number, target = DEFAULT_RANDOMIZED_TEST_TARGET): string[] {
  explicitSeedSchema.parse(seed);
  return ['test', '--no-orphans', '--parallel', '--bail=1', '--randomize', `--seed=${seed}`, target];
}

export function randomizedTestReproduction(seed: number): string {
  explicitSeedSchema.parse(seed);
  return `RAWENGINE_BUN_TEST_SEED=${seed} bun run test:randomized`;
}

async function waitForChildExit(
  child: ReturnType<typeof Bun.spawn>,
  timeoutMs: number,
): Promise<{ exitCode: number; timedOut: boolean }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<{ exitCode: 124; timedOut: true }>((resolve) => {
    timeout = setTimeout(() => resolve({ exitCode: 124, timedOut: true }), timeoutMs);
  });
  try {
    return await Promise.race([child.exited.then((exitCode) => ({ exitCode, timedOut: false as const })), timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function processGroupExists(pid: number): Promise<boolean> {
  if (process.platform === 'win32') return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function terminateWorkerTree(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (process.platform === 'win32') {
    if (child.exitCode === null) child.kill('SIGTERM');
    await child.exited;
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
  for (let attempt = 0; attempt < 100 && (await processGroupExists(child.pid)); attempt += 1) await Bun.sleep(10);
  if (await processGroupExists(child.pid)) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  }
  await child.exited;
}

function parseTarget(args: string[]): string {
  if (args.length === 0) return DEFAULT_RANDOMIZED_TEST_TARGET;
  if (args.length === 2 && args[0] === '--target' && args[1] !== undefined) return args[1];
  throw new Error('Usage: run-bun-randomized-tests.ts [--target <test-path>]');
}

if (import.meta.main) {
  const seed = resolveRandomizedTestSeed(process.env['RAWENGINE_BUN_TEST_SEED'] ?? process.env['GITHUB_RUN_ID']);
  const passTimeoutMs = resolveRandomizedPassTimeout(process.env['RAWENGINE_BUN_TEST_TIMEOUT_MS']);
  const target = parseTarget(process.argv.slice(2));
  console.log(`Bun randomized isolation seed: ${seed}`);
  console.log(`Reproduce: ${randomizedTestReproduction(seed)}`);

  // Bun --rerun-each combined with --parallel overlaps duplicate copies of a
  // file. Repeat the complete natively parallel suite sequentially instead.
  for (let run = 1; run <= RANDOMIZED_SUITE_RUN_COUNT; run += 1) {
    console.log(`Bun randomized isolation pass ${run}/${RANDOMIZED_SUITE_RUN_COUNT}`);
    const child = Bun.spawn(['bun', ...buildRandomizedTestArgs(seed, target)], {
      detached: true,
      env: process.env,
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    });
    const result = await waitForChildExit(child, passTimeoutMs);
    if (result.exitCode !== 0) {
      await terminateWorkerTree(child);
    }
    if (result.timedOut) {
      console.error(`Bun randomized isolation pass ${run} exceeded ${String(passTimeoutMs)}ms and was terminated.`);
    }
    const exitCode = result.exitCode;
    if (exitCode !== 0) process.exit(exitCode);
  }
}
