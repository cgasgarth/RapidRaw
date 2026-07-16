#!/usr/bin/env bun

import process from 'node:process';

import { z } from 'zod';

export const DEFAULT_RANDOMIZED_TEST_TARGET = 'tests/pure-ts';
export const RANDOMIZED_SUITE_RUN_COUNT = 2;

const explicitSeedSchema = z.coerce.number().int().min(0).max(0xffff_ffff);

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
  return ['test', '--no-orphans', '--dots', '--parallel', '--randomize', `--seed=${seed}`, target];
}

export function randomizedTestReproduction(seed: number): string {
  explicitSeedSchema.parse(seed);
  return `RAWENGINE_BUN_TEST_SEED=${seed} bun run test:randomized`;
}

function parseTarget(args: string[]): string {
  if (args.length === 0) return DEFAULT_RANDOMIZED_TEST_TARGET;
  if (args.length === 2 && args[0] === '--target' && args[1] !== undefined) return args[1];
  throw new Error('Usage: run-bun-randomized-tests.ts [--target <test-path>]');
}

if (import.meta.main) {
  const seed = resolveRandomizedTestSeed(process.env['RAWENGINE_BUN_TEST_SEED'] ?? process.env['GITHUB_RUN_ID']);
  const target = parseTarget(process.argv.slice(2));
  console.log(`Bun randomized isolation seed: ${seed}`);
  console.log(`Reproduce: ${randomizedTestReproduction(seed)}`);

  // Bun --rerun-each combined with --parallel overlaps duplicate copies of a
  // file. Repeat the complete natively parallel suite sequentially instead.
  for (let run = 1; run <= RANDOMIZED_SUITE_RUN_COUNT; run += 1) {
    console.log(`Bun randomized isolation pass ${run}/${RANDOMIZED_SUITE_RUN_COUNT}`);
    const child = Bun.spawn(['bun', ...buildRandomizedTestArgs(seed, target)], {
      env: process.env,
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) process.exit(exitCode);
  }
}
