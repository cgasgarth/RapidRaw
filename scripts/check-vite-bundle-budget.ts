#!/usr/bin/env bun

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';

import { VITE_BUNDLE_BUDGET_POLICY } from './lib/vite-bundle-policy.ts';

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

const AssetBudgetSchema = z
  .object({
    extension: z.string().regex(/^\.[a-z0-9]+$/u),
    label: z.string().min(1),
    maxBytes: z.number().int().positive(),
    maxGzipBytes: z.number().int().positive(),
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

const assetsDir = new URL(`../${bundleBudget.assetsDir}/`, import.meta.url);
const distIndexPath = new URL('../dist/index.html', import.meta.url);
const budgetMode = VITE_BUNDLE_BUDGET_POLICY.budgetMode;

const formatBytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;

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
      const filePath = join(assetsDir.pathname, entry.name);
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

const failures: string[] = [];

for (const budget of bundleBudget.budgets) {
  const matchingFiles = files.filter((file) => file.extension === budget.extension);
  const largest = matchingFiles.toSorted((a, b) => b.size - a.size)[0];

  if (!largest) {
    failures.push(`${budget.label}: no ${budget.extension} files found in ${bundleBudget.assetsDir}`);
    continue;
  }

  const line = [
    `${budget.label}: ${largest.name}`,
    `${formatBytes(largest.size)} / ${formatBytes(budget.maxBytes)}`,
    `gzip ${formatBytes(largest.gzipSize)} / ${formatBytes(budget.maxGzipBytes)}`,
  ].join(' | ');

  console.log(line);

  if (largest.size > budget.maxBytes) {
    failures.push(
      `${budget.label}: raw size exceeded (${formatBytes(largest.size)} > ${formatBytes(budget.maxBytes)})`,
    );
  }

  if (largest.gzipSize > budget.maxGzipBytes) {
    failures.push(
      `${budget.label}: gzip size exceeded (${formatBytes(largest.gzipSize)} > ${formatBytes(budget.maxGzipBytes)})`,
    );
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
failures.push(...getInitialEntryFailures(initialEntryReport, initialEntryBudget));

if (failures.length > 0) {
  console.error(`\nBundle budget exceeded for ${budgetMode}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
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
): string[] {
  const includedFileNames = report.files.map((file) => file.name).join(', ');
  const budgetFailures: string[] = [];

  if (report.rawBytes > budget.maxBytes) {
    budgetFailures.push(
      `${budget.label}: raw size exceeded (${formatBytes(report.rawBytes)} > ${formatBytes(
        budget.maxBytes,
      )}); files: ${includedFileNames}`,
    );
  }

  if (report.gzipBytes > budget.maxGzipBytes) {
    budgetFailures.push(
      `${budget.label}: gzip size exceeded (${formatBytes(report.gzipBytes)} > ${formatBytes(
        budget.maxGzipBytes,
      )}); files: ${includedFileNames}`,
    );
  }

  return budgetFailures;
}

function visitStaticAsset(name: string, filesByName: Map<string, BundleFile>, visited: Set<string>): void {
  if (visited.has(name)) return;
  const file = filesByName.get(name);
  if (file === undefined) {
    failures.push(`Initial entry asset is missing from ${bundleBudget.assetsDir}: ${name}`);
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
  if (!aggregateFailures.some((failure) => failure.includes('entry.js') && failure.includes('static-a.js'))) {
    throw new Error('self-test: aggregate failure did not list included static files.');
  }

  console.log('vite bundle budget self-test ok');
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
