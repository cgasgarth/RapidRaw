#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import { parseHdrPerformanceReport } from '../../../../src/schemas/computational-merge/hdr/hdrPerformanceSchemas.ts';

const CHECKS = z
  .array(
    z
      .object({
        args: z.array(z.string().min(1)),
        budgetMs: z.number().int().positive(),
        id: z.enum(['alignment-smoke', 'deghosting-smoke', 'merge-weighting-smoke']),
      })
      .strict(),
  )
  .parse([
    { args: ['run', 'check:hdr-alignment-smoke'], budgetMs: 1_000, id: 'alignment-smoke' },
    { args: ['run', 'check:hdr-deghosting-smoke'], budgetMs: 1_000, id: 'deghosting-smoke' },
    { args: ['run', 'check:hdr-merge-weighting-smoke'], budgetMs: 1_000, id: 'merge-weighting-smoke' },
  ]);

const outputDir = resolve('artifacts/performance-smoke');
const outputPath = resolve(outputDir, 'hdr-performance-smoke-report.json');
const MAX_FAILURE_OUTPUT_CHARS = 12_000;

function writeBoundedOutput(name, value) {
  if (!value) return;
  const normalized = value.endsWith('\n') ? value : `${value}\n`;
  if (normalized.length <= MAX_FAILURE_OUTPUT_CHARS) {
    process.stderr.write(normalized);
    return;
  }

  console.error(`${name} truncated (${normalized.length} chars)`);
  process.stderr.write(normalized.slice(0, 6_000));
  console.error('\n[...]');
  process.stderr.write(normalized.slice(-6_000));
}

function runCheck(check) {
  return new Promise((resolveCheck) => {
    const startedAt = performance.now();
    const child = spawn('bun', check.args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => child.kill('SIGTERM'), check.budgetMs);
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      const elapsedMs = Number((performance.now() - startedAt).toFixed(3));
      const status = exitCode === 0 && elapsedMs <= check.budgetMs ? 'pass' : 'fail';
      if (status === 'fail') {
        writeBoundedOutput(`${check.id} stdout`, stdout.join(''));
        writeBoundedOutput(`${check.id} stderr`, stderr.join(''));
      }
      resolveCheck({
        budgetMs: check.budgetMs,
        elapsedMs,
        id: check.id,
        status,
      });
    });
  });
}

const startedAt = performance.now();
const results = [];
for (const check of CHECKS) {
  results.push(await runCheck(check));
}

const report = parseHdrPerformanceReport({
  issue: 173,
  results,
  runtimeStatus: 'synthetic_performance_smoke',
  schemaVersion: 1,
  totalElapsedMs: Number((performance.now() - startedAt).toFixed(3)),
});

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `HDR performance smoke ok ${report.results.map((result) => `${result.id}=${Math.round(result.elapsedMs)}ms`).join(' ')}`,
);
