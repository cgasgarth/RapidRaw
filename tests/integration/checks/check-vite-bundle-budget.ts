#!/usr/bin/env bun

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';

import { VITE_BUNDLE_BUDGET_POLICY } from '../../../scripts/lib/ci/vite-bundle-policy.ts';

type BundleFile = {
  contents: Buffer;
  extension: string;
  gzipSize: number;
  name: string;
  size: number;
};

type InitialEntryReport = {
  files: BundleFile[];
  gzipBytes: number;
  rawBytes: number;
};

type BundleBudgetMetric = 'gzip' | 'missing' | 'raw';

type BundleBudgetFailure = {
  actualBytes?: number;
  assetName?: string;
  budgetBytes?: number;
  files?: string[];
  label: string;
  metric: BundleBudgetMetric;
  nextAction: string;
};

type BundleBudgetWarning = BundleBudgetFailure;

const AssetBudgetSchema = z
  .object({
    extension: z.string().regex(/^\.[a-z0-9]+$/u),
    label: z.string().min(1),
    maxBytes: z.number().int().positive(),
    maxGzipBytes: z.number().int().positive(),
    warnBytes: z.number().int().positive(),
    warnGzipBytes: z.number().int().positive(),
  })
  .strict();

const BundleBudgetSchema = z
  .object({
    assetsDir: z.string().min(1),
    budgets: z.array(AssetBudgetSchema).min(1),
  })
  .strict();

const bundleBudget = BundleBudgetSchema.parse({
  assetsDir: VITE_BUNDLE_BUDGET_POLICY.assetsDir,
  budgets: VITE_BUNDLE_BUDGET_POLICY.budgets,
});

const assetsDir = join(process.cwd(), bundleBudget.assetsDir);
const distIndexPath = join(process.cwd(), 'dist/index.html');
const budgetMode = VITE_BUNDLE_BUDGET_POLICY.budgetMode;

const formatBytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
const reproduceCommand = 'bun run check:bundle';
const bundleRunbook = 'docs/tooling/frontend/vite-bundle-budget-2026-06-11.md';

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

let entries;
try {
  entries = await readdir(assetsDir, { withFileTypes: true });
} catch (error) {
  console.error(`Unable to read ${bundleBudget.assetsDir}. Run the ${budgetMode} before checking bundle budget.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const files: BundleFile[] = await Promise.all(
  entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const filePath = join(assetsDir, entry.name);
      const [fileStat, contents] = await Promise.all([stat(filePath), readFile(filePath)]);

      return {
        contents,
        extension: extname(entry.name),
        gzipSize: gzipSync(contents).byteLength,
        name: entry.name,
        size: fileStat.size,
      };
    }),
);

const failures: BundleBudgetFailure[] = [];
const warnings: BundleBudgetWarning[] = [];

for (const budget of bundleBudget.budgets) {
  const matchingFiles = files.filter((file) => file.extension === budget.extension);
  const largest = matchingFiles.toSorted((a, b) => b.size - a.size)[0];

  if (!largest) {
    failures.push({
      label: budget.label,
      metric: 'missing',
      nextAction: `Run ${reproduceCommand} locally and confirm Vite emitted ${budget.extension} assets under ${bundleBudget.assetsDir}.`,
    });
    continue;
  }

  const line = [
    `${budget.label}: ${largest.name}`,
    `${formatBytes(largest.size)} / ${formatBytes(budget.maxBytes)}`,
    `gzip ${formatBytes(largest.gzipSize)} / ${formatBytes(budget.maxGzipBytes)}`,
  ].join(' | ');

  console.log(line);

  warnings.push(
    ...getThresholdWarnings({
      actualGzipBytes: largest.gzipSize,
      actualRawBytes: largest.size,
      assetName: largest.name,
      budget,
      nextAction:
        'Treat this as early signal: split non-startup UI, remove unused code, or document why temporary headroom is still intentional before the hard fail tier is reached.',
    }),
  );

  if (largest.size > budget.maxBytes) {
    failures.push({
      actualBytes: largest.size,
      assetName: largest.name,
      budgetBytes: budget.maxBytes,
      label: budget.label,
      metric: 'raw',
      nextAction:
        'Split startup code, remove unused code, lazy-load non-initial UI, or open a measured budget recalibration with headroom evidence.',
    });
  }

  if (largest.gzipSize > budget.maxGzipBytes) {
    failures.push({
      actualBytes: largest.gzipSize,
      assetName: largest.name,
      budgetBytes: budget.maxGzipBytes,
      label: budget.label,
      metric: 'gzip',
      nextAction:
        'Inspect dependency composition, split compressible bulk, lazy-load non-initial UI, or open a measured budget recalibration with headroom evidence.',
    });
  }
}

const initialEntryReport = buildInitialEntryReport({
  filesByName: new Map(files.map((file) => [file.name, file])),
  indexHtml: await readFile(distIndexPath, 'utf8'),
});
const initialEntryFiles = initialEntryReport.files;
const initialEntryBudget = VITE_BUNDLE_BUDGET_POLICY.initialEntryAggregate;
console.log(
  [
    `${initialEntryBudget.label}: ${initialEntryFiles.map((file) => file.name).join(', ')}`,
    `${formatBytes(initialEntryReport.rawBytes)} / ${formatBytes(initialEntryBudget.maxBytes)}`,
    `gzip ${formatBytes(initialEntryReport.gzipBytes)} / ${formatBytes(initialEntryBudget.maxGzipBytes)}`,
  ].join(' | '),
);
warnings.push(
  ...getThresholdWarnings({
    actualGzipBytes: initialEntryReport.gzipBytes,
    actualRawBytes: initialEntryReport.rawBytes,
    budget: initialEntryBudget,
    files: initialEntryFiles.map((file) => file.name),
    nextAction:
      'Treat this as early signal: move non-startup code behind dynamic imports or document a temporary exception before the hard fail tier is reached.',
  }),
);
failures.push(...getInitialEntryFailures(initialEntryReport, initialEntryBudget));

for (const warning of warnings.filter((warning) => !isCoveredByFailure(warning, failures))) {
  console.warn(`Bundle budget warning: ${formatBudgetFailure(warning)}`);
  if (process.env.GITHUB_ACTIONS === 'true') console.warn(formatGitHubWarningAnnotation(warning));
}

if (failures.length > 0) {
  console.error(`\nBundle budget exceeded for ${budgetMode}:`);
  for (const failure of failures) {
    console.error(`- ${formatBudgetFailure(failure)}`);
  }
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const failure of failures) console.error(formatGitHubAnnotation(failure));
  }
  process.exit(1);
}

console.log(`Bundle budget passed for ${budgetMode}.`);

function buildInitialEntryReport({
  filesByName,
  indexHtml,
}: {
  filesByName: Map<string, BundleFile>;
  indexHtml: string;
}): InitialEntryReport {
  const visited = new Set<string>();
  const initialNames = [...extractHtmlAssetNames(indexHtml)].toSorted();
  for (const name of initialNames) visitStaticAsset(name, filesByName, visited);
  const initialEntryFiles = [...visited].toSorted().map((name) => {
    const file = filesByName.get(name);
    if (file === undefined) throw new Error(`Initial entry asset disappeared during traversal: ${name}`);
    return file;
  });

  return {
    files: initialEntryFiles,
    gzipBytes: initialEntryFiles.reduce((total, file) => total + file.gzipSize, 0),
    rawBytes: initialEntryFiles.reduce((total, file) => total + file.size, 0),
  };
}

function getInitialEntryFailures(
  report: InitialEntryReport,
  budget: { label: string; maxBytes: number; maxGzipBytes: number },
): BundleBudgetFailure[] {
  const includedFileNames = report.files.map((file) => file.name);
  const budgetFailures: BundleBudgetFailure[] = [];

  if (report.rawBytes > budget.maxBytes) {
    budgetFailures.push({
      actualBytes: report.rawBytes,
      budgetBytes: budget.maxBytes,
      files: includedFileNames,
      label: budget.label,
      metric: 'raw',
      nextAction:
        'Move non-startup code behind dynamic imports, split initial-only dependencies, remove unused code, or open a measured budget recalibration with headroom evidence.',
    });
  }

  if (report.gzipBytes > budget.maxGzipBytes) {
    budgetFailures.push({
      actualBytes: report.gzipBytes,
      budgetBytes: budget.maxGzipBytes,
      files: includedFileNames,
      label: budget.label,
      metric: 'gzip',
      nextAction:
        'Inspect startup dependency composition, split compressible bulk behind dynamic imports, or open a measured budget recalibration with headroom evidence.',
    });
  }

  return budgetFailures;
}

function getThresholdWarnings({
  actualGzipBytes,
  actualRawBytes,
  assetName,
  budget,
  files,
  nextAction,
}: {
  actualGzipBytes: number;
  actualRawBytes: number;
  assetName?: string;
  budget: { label: string; maxBytes: number; maxGzipBytes: number; warnBytes: number; warnGzipBytes: number };
  files?: string[];
  nextAction: string;
}): BundleBudgetWarning[] {
  const budgetWarnings: BundleBudgetWarning[] = [];
  if (actualRawBytes > budget.warnBytes && actualRawBytes <= budget.maxBytes) {
    budgetWarnings.push({
      actualBytes: actualRawBytes,
      assetName,
      budgetBytes: budget.warnBytes,
      files,
      label: budget.label,
      metric: 'raw',
      nextAction,
    });
  }
  if (actualGzipBytes > budget.warnGzipBytes && actualGzipBytes <= budget.maxGzipBytes) {
    budgetWarnings.push({
      actualBytes: actualGzipBytes,
      assetName,
      budgetBytes: budget.warnGzipBytes,
      files,
      label: budget.label,
      metric: 'gzip',
      nextAction,
    });
  }
  return budgetWarnings;
}

function isCoveredByFailure(warning: BundleBudgetWarning, failuresToCheck: BundleBudgetFailure[]): boolean {
  return failuresToCheck.some(
    (failure) =>
      failure.label === warning.label &&
      failure.metric === warning.metric &&
      failure.assetName === warning.assetName &&
      failure.files?.join('\n') === warning.files?.join('\n'),
  );
}

function visitStaticAsset(name: string, filesByName: Map<string, BundleFile>, visited: Set<string>): void {
  if (visited.has(name)) return;
  const file = filesByName.get(name);
  if (file === undefined) {
    failures.push({
      assetName: name,
      label: 'Initial entry aggregate',
      metric: 'missing',
      nextAction: `Run ${reproduceCommand} locally and confirm Vite emitted referenced assets under ${bundleBudget.assetsDir}.`,
    });
    return;
  }

  visited.add(name);
  if (file.extension !== '.js') return;

  for (const importedName of extractStaticImportAssetNames(file.contents.toString('utf8'))) {
    visitStaticAsset(importedName, filesByName, visited);
  }
}

function extractHtmlAssetNames(indexHtml: string): Set<string> {
  const names = new Set<string>();
  const assetReferencePattern = /(?:src|href)=["']\/assets\/([^"']+\.(?:css|js))["']/gu;
  for (const match of indexHtml.matchAll(assetReferencePattern)) {
    const [, name] = match;
    if (name !== undefined) names.add(name);
  }
  return names;
}

function extractStaticImportAssetNames(source: string): Set<string> {
  const names = new Set<string>();
  const staticImportPattern = /\bimport\s+(?:[\w*{}\s,$]+from\s*)?["']\.\/([^"']+\.(?:css|js))["']/gu;
  for (const match of source.matchAll(staticImportPattern)) {
    const [, name] = match;
    if (name !== undefined) names.add(basename(name));
  }
  return names;
}

function formatBudgetFailure(failure: BundleBudgetFailure): string {
  const parts = [
    `${failure.label}: ${formatMetricLabel(failure.metric)}${formatAssetSuffix(failure)}`,
    formatBudgetDelta(failure),
    `run ${reproduceCommand}`,
    `see ${bundleRunbook}`,
    `next: ${failure.nextAction}`,
  ].filter((part) => part.length > 0);
  return parts.join(' | ');
}

function formatMetricLabel(metric: BundleBudgetMetric): string {
  if (metric === 'raw') return 'raw size exceeded';
  if (metric === 'gzip') return 'gzip size exceeded';
  return 'expected asset missing';
}

function formatAssetSuffix(failure: BundleBudgetFailure): string {
  if (failure.assetName !== undefined) return ` for ${failure.assetName}`;
  if (failure.files !== undefined) return ` for ${failure.files.join(', ')}`;
  return '';
}

function formatBudgetDelta(failure: BundleBudgetFailure): string {
  if (failure.actualBytes === undefined || failure.budgetBytes === undefined) return '';
  const deltaBytes = failure.actualBytes - failure.budgetBytes;
  return `${formatBytes(failure.actualBytes)} / ${formatBytes(failure.budgetBytes)} (${formatBytes(deltaBytes)} over)`;
}

function formatGitHubAnnotation(failure: BundleBudgetFailure): string {
  const title = escapeGitHubAnnotationProperty(`Bundle budget: ${failure.label}`);
  const message = escapeGitHubAnnotationMessage(formatBudgetFailure(failure));
  return `::error title=${title}::${message}`;
}

function formatGitHubWarningAnnotation(warning: BundleBudgetWarning): string {
  const title = escapeGitHubAnnotationProperty(`Bundle budget warning: ${warning.label}`);
  const message = escapeGitHubAnnotationMessage(formatBudgetFailure(warning));
  return `::warning title=${title}::${message}`;
}

function escapeGitHubAnnotationMessage(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeGitHubAnnotationProperty(value: string): string {
  return escapeGitHubAnnotationMessage(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function runSelfTest(): void {
  const fixtureFiles = [
    fixtureFile('entry.js', 600, 120, 'import "./static-a.js"; import("./lazy.js");'),
    fixtureFile('static-a.js', 600, 120, 'console.log("static");'),
    fixtureFile('lazy.js', 2_000, 400, 'console.log("lazy");'),
    fixtureFile('entry.css', 100, 20, '.root{}'),
  ];
  const report = buildInitialEntryReport({
    filesByName: new Map(fixtureFiles.map((file) => [file.name, file])),
    indexHtml: [
      '<script type="module" src="/assets/entry.js"></script>',
      '<link rel="stylesheet" href="/assets/entry.css">',
    ].join('\n'),
  });
  const includedNames = report.files.map((file) => file.name);
  if (!includedNames.includes('static-a.js')) throw new Error('self-test: static import was not included.');
  if (includedNames.includes('lazy.js')) throw new Error('self-test: dynamic import was included.');

  const aggregateFailures = getInitialEntryFailures(report, {
    label: 'Initial entry aggregate',
    maxBytes: 1_000,
    maxGzipBytes: 1_000,
  });
  const formattedFailure = aggregateFailures.map(formatBudgetFailure).join('\n');
  if (!formattedFailure.includes('entry.js') || !formattedFailure.includes('static-a.js')) {
    throw new Error('self-test: aggregate failure did not list included static files.');
  }
  const annotation = formatGitHubAnnotation(aggregateFailures[0] ?? failSelfTest('aggregate failure missing.'));
  if (!annotation.startsWith('::error title=Bundle budget%3A Initial entry aggregate::')) {
    throw new Error('self-test: GitHub annotation format is invalid.');
  }
  if (!annotation.includes(reproduceCommand) || !annotation.includes(bundleRunbook)) {
    throw new Error('self-test: annotation is missing reproduction guidance.');
  }

  const thresholdWarnings = getThresholdWarnings({
    actualGzipBytes: 900,
    actualRawBytes: 900,
    assetName: 'entry.js',
    budget: {
      label: 'Largest JavaScript asset',
      maxBytes: 1_000,
      maxGzipBytes: 1_000,
      warnBytes: 800,
      warnGzipBytes: 800,
    },
    nextAction: 'reduce size before hard fail.',
  });
  if (thresholdWarnings.length !== 2) throw new Error('self-test: warning tier was not detected.');
  const warningAnnotation = formatGitHubWarningAnnotation(thresholdWarnings[0] ?? failSelfTest('warning missing.'));
  if (!warningAnnotation.startsWith('::warning title=Bundle budget warning%3A Largest JavaScript asset::')) {
    throw new Error('self-test: GitHub warning annotation format is invalid.');
  }

  console.log('vite bundle budget self-test ok');
}

function failSelfTest(message: string): never {
  throw new Error(`self-test: ${message}`);
}

function fixtureFile(name: string, size: number, gzipSize: number, source: string): BundleFile {
  return {
    contents: Buffer.from(source),
    extension: extname(name),
    gzipSize,
    name,
    size,
  };
}
