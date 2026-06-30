#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

const BudgetSchema = z.object({
  actualGzipBytes: z.number(),
  actualRawBytes: z.number(),
  gzipBudgetBytes: z.number(),
  label: z.string(),
  rawBudgetBytes: z.number(),
  status: z.enum(['fail', 'pass']),
});

const ReportSchema = z.object({
  budgets: z.array(BudgetSchema),
  sourceMapAnalysis: z.object({
    reason: z.string().optional(),
    status: z.enum(['available', 'unavailable']),
    topPackages: z.array(
      z.object({
        bytes: z.number(),
        packageName: z.string(),
        sourceCount: z.number(),
      }),
    ),
  }),
  summary: z.object({
    initialEntryGzipBytes: z.number(),
    initialEntryRawBytes: z.number(),
    largestAsset: z.string(),
    totalGzipBytes: z.number(),
    totalRawBytes: z.number(),
  }),
});

type BundleReport = z.infer<typeof ReportSchema>;

const reportPath = readOption('--report') ?? 'artifacts/bundle-report/vite-bundle-report.json';
const baseReportPath = readOption('--base-report');

if (process.argv.includes('--self-test')) {
  await runSelfTest();
  process.exit(0);
}

const report = await readReport(reportPath);
const baseReport = baseReportPath === undefined ? undefined : await readReport(baseReportPath);
const markdown = renderSummary(report, baseReport);

if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
}

console.log(
  `vite bundle summary ok (${formatBytes(report.summary.initialEntryRawBytes)} raw, ${formatBytes(
    report.summary.initialEntryGzipBytes,
  )} gzip)`,
);

async function readReport(path: string): Promise<BundleReport> {
  return ReportSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

function renderSummary(report: BundleReport, baseReport: BundleReport | undefined): string {
  const lines = ['## Vite Bundle Summary', '', '| Metric | Current | Delta |', '| --- | ---: | ---: |'];
  lines.push(
    row(
      'Initial entry raw',
      report.summary.initialEntryRawBytes,
      baseReport === undefined
        ? undefined
        : report.summary.initialEntryRawBytes - baseReport.summary.initialEntryRawBytes,
    ),
  );
  lines.push(
    row(
      'Initial entry gzip',
      report.summary.initialEntryGzipBytes,
      baseReport === undefined
        ? undefined
        : report.summary.initialEntryGzipBytes - baseReport.summary.initialEntryGzipBytes,
    ),
  );
  lines.push(
    row(
      'Total raw',
      report.summary.totalRawBytes,
      baseReport === undefined ? undefined : report.summary.totalRawBytes - baseReport.summary.totalRawBytes,
    ),
  );
  lines.push(
    row(
      'Total gzip',
      report.summary.totalGzipBytes,
      baseReport === undefined ? undefined : report.summary.totalGzipBytes - baseReport.summary.totalGzipBytes,
    ),
  );
  lines.push('', `Largest asset: \`${report.summary.largestAsset}\``, '', '### Budget Status', '');
  lines.push('| Budget | Raw | Gzip | Status |');
  lines.push('| --- | ---: | ---: | --- |');
  for (const budget of report.budgets) {
    lines.push(
      `| ${budget.label} | ${formatBytes(budget.actualRawBytes)} / ${formatBytes(
        budget.rawBudgetBytes,
      )} | ${formatBytes(budget.actualGzipBytes)} / ${formatBytes(budget.gzipBudgetBytes)} | ${budget.status} |`,
    );
  }
  lines.push('', '### Largest Contributors', '');
  if (report.sourceMapAnalysis.status === 'available') {
    lines.push('| Package | Source bytes | Sources |');
    lines.push('| --- | ---: | ---: |');
    for (const contributor of report.sourceMapAnalysis.topPackages.slice(0, 5)) {
      lines.push(`| \`${contributor.packageName}\` | ${formatBytes(contributor.bytes)} | ${contributor.sourceCount} |`);
    }
  } else {
    lines.push(report.sourceMapAnalysis.reason ?? 'Source-map attribution unavailable for this production build.');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function row(label: string, current: number, delta: number | undefined): string {
  return `| ${label} | ${formatBytes(current)} | ${delta === undefined ? 'n/a' : formatSignedBytes(delta)} |`;
}

function formatSignedBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const prefix = bytes > 0 ? '+' : '-';
  return `${prefix}${formatBytes(Math.abs(bytes))}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function runSelfTest(): Promise<void> {
  const baseReport = ReportSchema.parse({
    budgets: [
      {
        actualGzipBytes: 90,
        actualRawBytes: 180,
        gzipBudgetBytes: 100,
        label: 'Largest JavaScript asset',
        rawBudgetBytes: 200,
        status: 'pass',
      },
    ],
    sourceMapAnalysis: { status: 'unavailable', topPackages: [] },
    summary: {
      initialEntryGzipBytes: 90,
      initialEntryRawBytes: 180,
      largestAsset: 'index-base.js',
      totalGzipBytes: 100,
      totalRawBytes: 200,
    },
  });
  const headReport = ReportSchema.parse({
    ...baseReport,
    summary: {
      initialEntryGzipBytes: 95,
      initialEntryRawBytes: 190,
      largestAsset: 'index-head.js',
      totalGzipBytes: 105,
      totalRawBytes: 210,
    },
  });
  const summary = renderSummary(headReport, baseReport);
  if (!summary.includes('+10 B') || !summary.includes('Largest JavaScript asset')) {
    throw new Error('Bundle summary self-test failed to render delta and budget status.');
  }
  console.log('vite bundle summary self-test ok');
}
