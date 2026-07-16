#!/usr/bin/env bun

import process from 'node:process';

type Metric = { found: number; hit: number };

export const BUN_COVERAGE_FLOORS = {
  // July 2026 LCOV baseline (1845 tests): 66.44% lines, 69.87% functions.
  functions: 0.69,
  lines: 0.66,
} as const;

export function summarizeLcov(lcov: string): { functions: Metric; lines: Metric } {
  const summary = {
    functions: { found: 0, hit: 0 },
    lines: { found: 0, hit: 0 },
  };
  for (const line of lcov.split('\n')) {
    const value = Number(line.slice(line.indexOf(':') + 1));
    if (line.startsWith('FNF:')) summary.functions.found += value;
    if (line.startsWith('FNH:')) summary.functions.hit += value;
    if (line.startsWith('LF:')) summary.lines.found += value;
    if (line.startsWith('LH:')) summary.lines.hit += value;
  }
  if (summary.functions.found === 0 || summary.lines.found === 0) {
    throw new Error('Bun LCOV report did not contain function and line totals.');
  }
  return summary;
}

export function enforceCoverageFloors(summary: { functions: Metric; lines: Metric }): void {
  const failures = Object.entries(BUN_COVERAGE_FLOORS).flatMap(([name, floor]) => {
    const metric = summary[name as keyof typeof BUN_COVERAGE_FLOORS];
    const actual = metric.hit / metric.found;
    return actual < floor ? [`${name} ${(actual * 100).toFixed(2)}% < ${(floor * 100).toFixed(2)}%`] : [];
  });
  if (failures.length > 0) throw new Error(`Bun coverage floor failed: ${failures.join(', ')}`);
}

function percent(metric: Metric): string {
  return ((metric.hit / metric.found) * 100).toFixed(2);
}

if (import.meta.main) {
  const reportPath = 'artifacts/bun-coverage/lcov.info';
  const summary = summarizeLcov(await Bun.file(reportPath).text());
  const message = `Bun coverage: ${percent(summary.lines)}% lines (${summary.lines.hit}/${summary.lines.found}), ${percent(summary.functions)}% functions (${summary.functions.hit}/${summary.functions.found})`;
  console.log(message);
  enforceCoverageFloors(summary);

  const stepSummaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (stepSummaryPath !== undefined) {
    await Bun.write(stepSummaryPath, `## Bun native coverage\n\n${message}\n`);
  }
}
