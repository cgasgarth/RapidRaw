#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { z } from 'zod';

const BudgetMultiplierSchema = z.coerce.number().positive().finite().default(1);

const SmokeCheckSchema = z
  .object({
    args: z.array(z.string().min(1)),
    budgetMs: z.number().int().positive(),
    command: z.string().min(1),
    id: z.string().regex(/^[a-z0-9-]+$/u),
    summary: z.string().min(1),
  })
  .strict();

const SmokeResultSchema = z
  .object({
    budgetMs: z.number().int().positive(),
    elapsedMs: z.number().nonnegative(),
    exitCode: z.number().int().nullable(),
    id: z.string().min(1),
    signal: z.string().nullable(),
    status: z.enum(['pass', 'fail']),
    summary: z.string().min(1),
  })
  .strict();

const SmokeReportSchema = z
  .object({
    budgetMultiplier: z.number().positive(),
    generatedAt: z.string().datetime(),
    results: z.array(SmokeResultSchema).min(1),
    schemaVersion: z.literal(1),
    totalElapsedMs: z.number().nonnegative(),
  })
  .strict();

const budgetMultiplier = BudgetMultiplierSchema.parse(process.env.RAWENGINE_PERFORMANCE_SMOKE_BUDGET_MULTIPLIER);
const outputDir = resolve('artifacts/performance-smoke');
const outputPath = resolve(outputDir, 'performance-smoke-report.json');
const MAX_FAILURE_OUTPUT_CHARS = 8_000;

const smokeChecks = z.array(SmokeCheckSchema).parse([
  {
    args: ['run', 'check:ci-paths'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'ci-path-classifier',
    summary: 'Path routing classifier self-test',
  },
  {
    args: ['run', 'check:generated-types'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'generated-type-drift',
    summary: 'Generated Tauri type drift manifest check',
  },
  {
    args: ['run', 'check:film-fixtures'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'film-look-fixtures',
    summary: 'Built-in film look fixture fingerprint check',
  },
  {
    args: ['run', 'check:hdr-fixtures'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'hdr-fixtures',
    summary: 'Synthetic HDR bracket fixture validation',
  },
  {
    args: ['run', 'schema:samples'],
    budgetMs: 10_000,
    command: 'bun',
    id: 'rawengine-schema-samples',
    summary: 'RawEngine schema sample artifact validation',
  },
  {
    args: ['run', 'check:sr-performance-fixtures'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'sr-performance-fixtures',
    summary: 'Super-resolution performance fixture budget validation',
  },
  {
    args: ['run', 'check:sr-synthetic-smoke'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'sr-synthetic-smoke',
    summary: 'Super-resolution synthetic pixel-shift smoke',
  },
  {
    args: ['run', 'check:panorama-performance-fixtures'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'panorama-performance-fixtures',
    summary: 'Panorama performance fixture budget validation',
  },
  {
    args: ['run', 'check:hdr-performance-smoke'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'hdr-performance-smoke',
    summary: 'HDR synthetic performance smoke',
  },
  {
    args: ['run', 'check:focus-alignment-smoke'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'focus-translation-alignment-smoke',
    summary: 'Focus stacking CPU translation alignment smoke',
  },
  {
    args: ['run', 'check:focus-sharpness-map-smoke'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'focus-sharpness-map-smoke',
    summary: 'Focus stacking CPU sharpness-map smoke',
  },
  {
    args: ['run', 'check:focus-preview-blend-smoke'],
    budgetMs: 5_000,
    command: 'bun',
    id: 'focus-preview-blend-smoke',
    summary: 'Focus stacking weighted-sharpness preview blend smoke',
  },
]);

const formatMs = (milliseconds) => `${Math.round(milliseconds)}ms`;

const appendBounded = (current, chunk) => {
  const next = `${current}${String(chunk)}`;
  if (next.length <= MAX_FAILURE_OUTPUT_CHARS) return next;
  return next.slice(-MAX_FAILURE_OUTPUT_CHARS);
};

const writeFailureOutput = (label, output) => {
  if (output.trim().length === 0) return;
  console.error(`${label} tail:`);
  console.error(output.trimEnd());
};

const runSmokeCheck = (check) =>
  new Promise((resolveCheck) => {
    const startedAt = performance.now();
    const effectiveBudgetMs = Math.ceil(check.budgetMs * budgetMultiplier);
    let stderr = '';
    let stdout = '';
    const child = spawn(check.command, check.args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, effectiveBudgetMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      const elapsedMs = performance.now() - startedAt;
      const status = exitCode === 0 && elapsedMs <= effectiveBudgetMs ? 'pass' : 'fail';
      if (status === 'fail') {
        writeFailureOutput(`${check.id} stdout`, stdout);
        writeFailureOutput(`${check.id} stderr`, stderr);
      }

      resolveCheck(
        SmokeResultSchema.parse({
          budgetMs: effectiveBudgetMs,
          elapsedMs: Number(elapsedMs.toFixed(3)),
          exitCode,
          id: check.id,
          signal,
          status,
          summary: check.summary,
        }),
      );
    });
  });

const runStartedAt = performance.now();
const results = [];

for (const check of smokeChecks) {
  const effectiveBudgetMs = Math.ceil(check.budgetMs * budgetMultiplier);
  console.log(`performance smoke: ${check.summary} (budget ${formatMs(effectiveBudgetMs)})`);
  const result = await runSmokeCheck(check);
  results.push(result);

  const statusText = result.status === 'pass' ? 'passed' : 'failed';
  console.log(`performance smoke: ${check.id} ${statusText} in ${formatMs(result.elapsedMs)}`);
}

const report = SmokeReportSchema.parse({
  budgetMultiplier,
  generatedAt: new Date().toISOString(),
  results,
  schemaVersion: 1,
  totalElapsedMs: Number((performance.now() - runStartedAt).toFixed(3)),
});

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

const failures = report.results.filter((result) => result.status === 'fail');
if (failures.length > 0) {
  console.error('\nPerformance smoke failed:');
  for (const failure of failures) {
    console.error(
      `- ${failure.id}: ${formatMs(failure.elapsedMs)} / ${formatMs(failure.budgetMs)}, exit=${failure.exitCode}, signal=${failure.signal ?? 'none'}`,
    );
  }
  console.error(`Report written to ${outputPath}`);
  process.exit(1);
}

console.log(`Performance smoke passed in ${formatMs(report.totalElapsedMs)}. Report written to ${outputPath}`);
