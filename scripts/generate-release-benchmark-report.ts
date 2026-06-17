#!/usr/bin/env bun
// @ts-check

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

const SmokeResultSchema = z
  .object({
    budgetMs: z.number().int().positive(),
    elapsedMs: z.number().nonnegative(),
    exitCode: z.number().int().nullable(),
    id: z.string().regex(/^[a-z0-9-]+$/u),
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

function parseArgs(args) {
  const parsed = {
    input: 'artifacts/performance-smoke/performance-smoke-report.json',
    output: 'artifacts/release-benchmarks/release-benchmark-report.md',
    release: 'local',
    selfTest: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--input':
        parsed.input = args[index + 1];
        index += 1;
        break;
      case '--output':
        parsed.output = args[index + 1];
        index += 1;
        break;
      case '--release':
        parsed.release = args[index + 1];
        index += 1;
        break;
      case '--self-test':
        parsed.selfTest = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

const formatMs = (value) => `${Math.round(value)}ms`;

function formatHeadroom(result) {
  const headroomMs = result.budgetMs - result.elapsedMs;
  const headroomPercent = Math.round((headroomMs / result.budgetMs) * 100);
  return `${formatMs(headroomMs)} (${headroomPercent}%)`;
}

export function renderReleaseBenchmarkReport({ release, report }) {
  const failures = report.results.filter((result) => result.status === 'fail');
  const rows = report.results
    .map((result) =>
      [
        result.id,
        result.summary,
        result.status,
        formatMs(result.elapsedMs),
        formatMs(result.budgetMs),
        formatHeadroom(result),
        result.exitCode === null ? 'n/a' : String(result.exitCode),
        result.signal ?? 'none',
      ].join(' | '),
    )
    .join('\n');

  return `# Release Benchmark Report

Release: ${release}
Generated: ${report.generatedAt}
Source schema: performance-smoke/v${report.schemaVersion}

## Summary

- Status: ${failures.length === 0 ? 'pass' : 'fail'}
- Total elapsed: ${formatMs(report.totalElapsedMs)}
- Budget multiplier: ${report.budgetMultiplier}
- Checks: ${report.results.length}
- Failures: ${failures.length}

## Results

| Check | Scope | Status | Elapsed | Budget | Headroom | Exit | Signal |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

## Limits

This report summarizes deterministic release-readiness smoke benchmarks. It is
not a full image-rendering, GPU, RAW decode, or interactive preview benchmark.
Promote real render benchmarks into this report only after those commands are
stable, reproducible, and tied to fixture manifests.
`;
}

export async function generateReleaseBenchmarkReport({ input, output, release }) {
  const report = SmokeReportSchema.parse(JSON.parse(readFileSync(input, 'utf8')));
  const markdown = renderReleaseBenchmarkReport({ release, report });

  await mkdir(path.dirname(output), { recursive: true });
  writeFileSync(output, markdown);

  const failures = report.results.filter((result) => result.status === 'fail');
  console.log(`Generated ${output}`);
  console.log(`Release benchmark status: ${failures.length === 0 ? 'pass' : 'fail'}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }

  return { failures, output };
}

async function runSelfTest() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'rapidraw-release-benchmark-report-'));

  try {
    const input = path.join(fixtureRoot, 'performance-smoke-report.json');
    const output = path.join(fixtureRoot, 'release-benchmark-report.md');

    writeFileSync(
      input,
      `${JSON.stringify(
        {
          budgetMultiplier: 1,
          generatedAt: '2026-06-14T00:00:00.000Z',
          results: [
            {
              budgetMs: 5000,
              elapsedMs: 1250.25,
              exitCode: 0,
              id: 'fixture-check',
              signal: null,
              status: 'pass',
              summary: 'Fixture benchmark command',
            },
          ],
          schemaVersion: 1,
          totalElapsedMs: 1250.25,
        },
        null,
        2,
      )}\n`,
    );

    await generateReleaseBenchmarkReport({ input, output, release: 'self-test' });

    const markdown = readFileSync(output, 'utf8');
    if (!markdown.includes('Release: self-test') || !markdown.includes('fixture-check')) {
      throw new Error(`Unexpected benchmark report content: ${markdown}`);
    }

    console.log('generate-release-benchmark-report self-test passed');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.selfTest) {
  await runSelfTest();
} else {
  await generateReleaseBenchmarkReport(args);
}
