#!/usr/bin/env bun

import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';

import { VITE_BUNDLE_BUDGET_POLICY } from './lib/vite-bundle-policy.ts';

type BundleAsset = {
  extension: string;
  gzipBytes: number;
  initialEntry: boolean;
  name: string;
  rawBytes: number;
};

type BundleFile = BundleAsset & {
  contents: Buffer;
  path: string;
};

type SourceContributor = {
  asset: string;
  bytes: number;
  packageName: string | null;
  source: string;
  sourceType: 'first-party' | 'third-party' | 'unknown';
};

type BundleReport = {
  assets: BundleAsset[];
  budgetMode: string;
  budgets: {
    actualGzipBytes: number;
    actualRawBytes: number;
    gzipBudgetBytes: number;
    label: string;
    rawBudgetBytes: number;
    status: 'fail' | 'pass';
  }[];
  generatedAt: string;
  initialEntry: {
    files: string[];
    gzipBytes: number;
    rawBytes: number;
  };
  sourceMapAnalysis: {
    reason?: string;
    status: 'available' | 'unavailable';
    topPackages: {
      bytes: number;
      packageName: string;
      sourceCount: number;
    }[];
    topSources: SourceContributor[];
  };
  summary: {
    assetCount: number;
    initialEntryGzipBytes: number;
    initialEntryRawBytes: number;
    largestAsset: string;
    totalGzipBytes: number;
    totalRawBytes: number;
  };
};

const CliSchema = z
  .object({
    outputDir: z.string().min(1),
  })
  .strict();

const SourceMapSchema = z
  .object({
    sources: z.array(z.string()),
    sourcesContent: z.array(z.string().nullable()).optional(),
    version: z.number(),
  })
  .passthrough();

const defaultOutputDir = 'artifacts/bundle-report';
const cli = CliSchema.parse({
  outputDir: readOption('--output-dir') ?? defaultOutputDir,
});

if (process.argv.includes('--self-test')) {
  await runSelfTest();
  process.exit(0);
}

await writeReport({
  assetsDir: VITE_BUNDLE_BUDGET_POLICY.assetsDir,
  distIndexPath: 'dist/index.html',
  outputDir: cli.outputDir,
});

async function writeReport({
  assetsDir,
  distIndexPath,
  outputDir,
}: {
  assetsDir: string;
  distIndexPath: string;
  outputDir: string;
}): Promise<void> {
  const report = await buildReport({ assetsDir, distIndexPath });
  await mkdir(outputDir, { recursive: true });

  await Promise.all([
    writeFile(join(outputDir, 'vite-bundle-report.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(outputDir, 'vite-bundle-report.md'), renderMarkdown(report)),
  ]);

  console.log(`vite bundle report ok (${report.summary.assetCount} assets)`);
}

async function buildReport({
  assetsDir,
  distIndexPath,
}: {
  assetsDir: string;
  distIndexPath: string;
}): Promise<BundleReport> {
  const [entries, indexHtml] = await Promise.all([
    readdir(assetsDir, { withFileTypes: true }).catch((error: unknown) => {
      throw new Error(`Unable to read ${assetsDir}. Run bun run build:frontend first. ${formatError(error)}`);
    }),
    readFile(distIndexPath, 'utf8').catch((error: unknown) => {
      throw new Error(`Unable to read ${distIndexPath}. Run bun run build:frontend first. ${formatError(error)}`);
    }),
  ]);

  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = join(assetsDir, entry.name);
        const [fileStat, contents] = await Promise.all([stat(path), readFile(path)]);
        return {
          contents,
          extension: extname(entry.name),
          gzipBytes: gzipSync(contents).byteLength,
          name: entry.name,
          path,
          rawBytes: fileStat.size,
        };
      }),
  );

  if (files.length === 0) throw new Error(`No bundle assets found in ${assetsDir}. Run bun run build:frontend first.`);

  const filesByName = new Map(files.map((file) => [file.name, file]));
  const initialEntryNames = collectInitialEntryNames(indexHtml, filesByName);
  const assets = files
    .map<BundleAsset>((file) => ({
      extension: file.extension,
      gzipBytes: file.gzipBytes,
      initialEntry: initialEntryNames.has(file.name),
      name: file.name,
      rawBytes: file.rawBytes,
    }))
    .toSorted((a, b) => b.rawBytes - a.rawBytes);
  const initialEntryAssets = assets.filter((asset) => asset.initialEntry);
  const largestAsset = assets[0];
  if (largestAsset === undefined) throw new Error(`No bundle assets found in ${assetsDir}.`);

  return {
    assets,
    budgetMode: VITE_BUNDLE_BUDGET_POLICY.budgetMode,
    budgets: buildBudgetStatuses(assets),
    generatedAt: new Date().toISOString(),
    initialEntry: {
      files: initialEntryAssets.map((asset) => asset.name).toSorted(),
      gzipBytes: sum(initialEntryAssets.map((asset) => asset.gzipBytes)),
      rawBytes: sum(initialEntryAssets.map((asset) => asset.rawBytes)),
    },
    sourceMapAnalysis: await buildSourceMapAnalysis(files),
    summary: {
      assetCount: assets.length,
      initialEntryGzipBytes: sum(initialEntryAssets.map((asset) => asset.gzipBytes)),
      initialEntryRawBytes: sum(initialEntryAssets.map((asset) => asset.rawBytes)),
      largestAsset: largestAsset.name,
      totalGzipBytes: sum(assets.map((asset) => asset.gzipBytes)),
      totalRawBytes: sum(assets.map((asset) => asset.rawBytes)),
    },
  };
}

async function buildSourceMapAnalysis(files: BundleFile[]): Promise<BundleReport['sourceMapAnalysis']> {
  const sourceContributors = (
    await Promise.all(
      files
        .filter((file) => file.extension === '.js' || file.extension === '.css')
        .map(async (file) => readSourceContributors(file)),
    )
  ).flat();

  if (sourceContributors.length === 0) {
    return {
      reason:
        'No adjacent source maps were found. Run TAURI_ENV_DEBUG=1 bun run build:frontend, then bun run bundle:report for attribution-only diagnostics.',
      status: 'unavailable',
      topPackages: [],
      topSources: [],
    };
  }

  const packageTotals = new Map<string, { bytes: number; sources: Set<string> }>();
  for (const contributor of sourceContributors) {
    if (contributor.packageName === null) continue;
    const existing = packageTotals.get(contributor.packageName) ?? { bytes: 0, sources: new Set<string>() };
    existing.bytes += contributor.bytes;
    existing.sources.add(contributor.source);
    packageTotals.set(contributor.packageName, existing);
  }

  return {
    status: 'available',
    topPackages: [...packageTotals.entries()]
      .map(([packageName, value]) => ({
        bytes: value.bytes,
        packageName,
        sourceCount: value.sources.size,
      }))
      .toSorted((a, b) => b.bytes - a.bytes)
      .slice(0, 20),
    topSources: sourceContributors.toSorted((a, b) => b.bytes - a.bytes).slice(0, 30),
  };
}

async function readSourceContributors(file: BundleFile): Promise<SourceContributor[]> {
  const sourceMapPath = `${file.path}.map`;
  let parsedMap;
  try {
    parsedMap = SourceMapSchema.parse(JSON.parse(await readFile(sourceMapPath, 'utf8')));
  } catch {
    return [];
  }

  return parsedMap.sources.map((source, index) => {
    const sourceContent = parsedMap.sourcesContent?.[index];
    const packageName = getPackageName(source);
    return {
      asset: file.name,
      bytes: sourceContent === undefined || sourceContent === null ? 0 : Buffer.byteLength(sourceContent),
      packageName,
      source,
      sourceType: packageName === null ? classifyFirstPartySource(source) : 'third-party',
    };
  });
}

function classifyFirstPartySource(source: string): SourceContributor['sourceType'] {
  if (source.includes('/src/') || source.startsWith('src/') || source.startsWith('../src/')) return 'first-party';
  return 'unknown';
}

function getPackageName(source: string): string | null {
  const nodeModulesIndex = source.lastIndexOf('node_modules/');
  if (nodeModulesIndex < 0) return null;
  const packagePath = source.slice(nodeModulesIndex + 'node_modules/'.length);
  const parts = packagePath.split('/');
  const [first, second] = parts;
  if (first === undefined || first.length === 0) return null;
  if (first.startsWith('@')) return second === undefined ? first : `${first}/${second}`;
  return first;
}

function buildBudgetStatuses(assets: BundleAsset[]): BundleReport['budgets'] {
  const statuses = VITE_BUNDLE_BUDGET_POLICY.budgets.map((budget) => {
    const largest = assets
      .filter((asset) => asset.extension === budget.extension)
      .toSorted((a, b) => b.rawBytes - a.rawBytes)[0];
    const actualRawBytes = largest?.rawBytes ?? 0;
    const actualGzipBytes = largest?.gzipBytes ?? 0;
    return {
      actualGzipBytes,
      actualRawBytes,
      gzipBudgetBytes: budget.maxGzipBytes,
      label: budget.label,
      rawBudgetBytes: budget.maxBytes,
      status: actualRawBytes > budget.maxBytes || actualGzipBytes > budget.maxGzipBytes ? 'fail' : 'pass',
    };
  });

  const initialAssets = assets.filter((asset) => asset.initialEntry);
  const initialRawBytes = sum(initialAssets.map((asset) => asset.rawBytes));
  const initialGzipBytes = sum(initialAssets.map((asset) => asset.gzipBytes));
  const initialBudget = VITE_BUNDLE_BUDGET_POLICY.initialEntryAggregate;
  statuses.push({
    actualGzipBytes: initialGzipBytes,
    actualRawBytes: initialRawBytes,
    gzipBudgetBytes: initialBudget.maxGzipBytes,
    label: initialBudget.label,
    rawBudgetBytes: initialBudget.maxBytes,
    status: initialRawBytes > initialBudget.maxBytes || initialGzipBytes > initialBudget.maxGzipBytes ? 'fail' : 'pass',
  });

  return statuses;
}

function collectInitialEntryNames(
  indexHtml: string,
  filesByName: Map<string, { contents: Buffer; extension: string; name: string }>,
): Set<string> {
  const visited = new Set<string>();
  for (const name of extractHtmlAssetNames(indexHtml)) visitStaticAsset(name, filesByName, visited);
  return visited;
}

function visitStaticAsset(
  name: string,
  filesByName: Map<string, { contents: Buffer; extension: string; name: string }>,
  visited: Set<string>,
): void {
  if (visited.has(name)) return;
  const file = filesByName.get(name);
  if (file === undefined) return;

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

function renderMarkdown(report: BundleReport): string {
  const topAssets = report.assets
    .slice(0, 20)
    .map(
      (asset) =>
        `| \`${asset.name}\` | ${asset.extension} | ${formatBytes(asset.rawBytes)} | ${formatBytes(asset.gzipBytes)} | ${
          asset.initialEntry ? 'yes' : 'no'
        } |`,
    )
    .join('\n');
  const budgetRows = report.budgets
    .map(
      (budget) =>
        `| ${budget.label} | ${budget.status} | ${formatBytes(budget.actualRawBytes)} / ${formatBytes(
          budget.rawBudgetBytes,
        )} | ${formatBytes(budget.actualGzipBytes)} / ${formatBytes(budget.gzipBudgetBytes)} |`,
    )
    .join('\n');
  const sourceAttribution =
    report.sourceMapAnalysis.status === 'available'
      ? renderSourceAttribution(report)
      : `## Source Attribution\n\nUnavailable: ${report.sourceMapAnalysis.reason}\n`;

  return `# Vite Bundle Report

- Generated: ${report.generatedAt}
- Budget mode: ${report.budgetMode}
- Asset count: ${report.summary.assetCount}
- Largest asset: \`${report.summary.largestAsset}\`
- Total raw: ${formatBytes(report.summary.totalRawBytes)}
- Total gzip: ${formatBytes(report.summary.totalGzipBytes)}
- Initial entry raw: ${formatBytes(report.summary.initialEntryRawBytes)}
- Initial entry gzip: ${formatBytes(report.summary.initialEntryGzipBytes)}

## Budget Status

| Budget | Status | Raw | Gzip |
| --- | --- | --- | --- |
${budgetRows}

## Top Assets

| Asset | Type | Raw | Gzip | Initial entry |
| --- | --- | --- | --- | --- |
${topAssets}

${sourceAttribution}
`;
}

function renderSourceAttribution(report: BundleReport): string {
  const topSourceRows = report.sourceMapAnalysis.topSources
    .slice(0, 15)
    .map(
      (source) =>
        `| \`${source.source}\` | \`${source.asset}\` | ${source.sourceType} | ${source.packageName ?? ''} | ${formatBytes(
          source.bytes,
        )} |`,
    )
    .join('\n');
  const topPackageRows = report.sourceMapAnalysis.topPackages
    .slice(0, 15)
    .map((entry) => `| \`${entry.packageName}\` | ${formatBytes(entry.bytes)} | ${entry.sourceCount} |`)
    .join('\n');

  return `## Source Attribution

| Source | Asset | Type | Package | Source bytes |
| --- | --- | --- | --- | --- |
${topSourceRows}

## Package Attribution

| Package | Source bytes | Sources |
| --- | --- | --- |
${topPackageRows}
`;
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runSelfTest(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rapidraw-bundle-report-'));
  try {
    await mkdir(join(root, 'dist/assets'), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'dist/index.html'), '<script type="module" src="/assets/entry.js"></script>'),
      writeFile(join(root, 'dist/assets/entry.js'), 'import "./static.js"; import("./lazy.js"); console.log("entry");'),
      writeFile(
        join(root, 'dist/assets/entry.js.map'),
        JSON.stringify({
          sources: ['../src/App.tsx', '../node_modules/@scope/pkg/index.js', '../node_modules/react/index.js'],
          sourcesContent: ['export const app = true;', 'export const scoped = true;', 'export const react = true;'],
          version: 3,
        }),
      ),
      writeFile(join(root, 'dist/assets/static.js'), 'console.log("static");'),
      writeFile(join(root, 'dist/assets/lazy.js'), 'console.log("lazy");'),
    ]);

    const report = await buildReport({
      assetsDir: join(root, 'dist/assets'),
      distIndexPath: join(root, 'dist/index.html'),
    });

    if (!report.initialEntry.files.includes('static.js')) throw new Error('self-test: static import missing.');
    if (report.initialEntry.files.includes('lazy.js')) throw new Error('self-test: dynamic import included.');
    if (report.assets.length !== 4) throw new Error('self-test: asset count mismatch.');
    if (report.sourceMapAnalysis.status !== 'available') throw new Error('self-test: source map analysis unavailable.');
    if (!report.sourceMapAnalysis.topPackages.some((entry) => entry.packageName === '@scope/pkg')) {
      throw new Error('self-test: scoped package attribution missing.');
    }
    if (!report.sourceMapAnalysis.topSources.some((entry) => entry.sourceType === 'first-party')) {
      throw new Error('self-test: first-party attribution missing.');
    }

    await writeReport({
      assetsDir: join(root, 'dist/assets'),
      distIndexPath: join(root, 'dist/index.html'),
      outputDir: join(root, 'artifacts/bundle-report'),
    });
    await readFile(join(root, 'artifacts/bundle-report/vite-bundle-report.json'), 'utf8');
    await readFile(join(root, 'artifacts/bundle-report/vite-bundle-report.md'), 'utf8');
  } finally {
    await rm(root, { force: true, recursive: true });
  }

  console.log('vite bundle report self-test ok');
}
