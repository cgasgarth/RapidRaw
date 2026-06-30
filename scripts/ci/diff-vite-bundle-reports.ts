#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

type AssetDelta = {
  gzipDeltaBytes: number;
  name: string;
  rawDeltaBytes: number;
  status: 'added' | 'changed' | 'removed' | 'unchanged';
};

type PackageDelta = {
  bytesDelta: number;
  packageName: string;
  status: 'added' | 'changed' | 'removed' | 'unchanged';
};

type BundleDiff = {
  assets: AssetDelta[];
  packages: PackageDelta[];
  summary: {
    assetCountDelta: number;
    changedAssetCount: number;
    gzipDeltaBytes: number;
    packageAttribution: 'available' | 'unavailable';
    rawDeltaBytes: number;
  };
};

const CliSchema = z
  .object({
    base: z.string().min(1),
    head: z.string().min(1),
    outputDir: z.string().min(1),
  })
  .strict();

const BundleAssetSchema = z
  .object({
    gzipBytes: z.number().int().nonnegative(),
    name: z.string().min(1),
    rawBytes: z.number().int().nonnegative(),
  })
  .passthrough();

const BundleReportSchema = z
  .object({
    assets: z.array(BundleAssetSchema),
    sourceMapAnalysis: z
      .object({
        topPackages: z
          .array(
            z
              .object({
                bytes: z.number().int().nonnegative(),
                packageName: z.string().min(1),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    summary: z
      .object({
        totalGzipBytes: z.number().int().nonnegative(),
        totalRawBytes: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

const defaultOutputDir = 'artifacts/bundle-report';

if (process.argv.includes('--self-test')) {
  await runSelfTest();
  process.exit(0);
}

const cli = CliSchema.parse({
  base: readRequiredOption('--base'),
  head: readRequiredOption('--head'),
  outputDir: readOption('--output-dir') ?? defaultOutputDir,
});
const diff = diffReports(await readReport(cli.base), await readReport(cli.head));
await writeDiff(diff, cli.outputDir);

async function readReport(path: string): Promise<z.infer<typeof BundleReportSchema>> {
  return BundleReportSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

async function writeDiff(diff: BundleDiff, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(join(outputDir, 'vite-bundle-diff.json'), `${JSON.stringify(diff, null, 2)}\n`),
    writeFile(join(outputDir, 'vite-bundle-diff.md'), renderMarkdown(diff)),
  ]);
  console.log(
    `vite bundle diff ok (${formatSignedBytes(diff.summary.rawDeltaBytes)} raw, ${formatSignedBytes(
      diff.summary.gzipDeltaBytes,
    )} gzip)`,
  );
}

function diffReports(base: z.infer<typeof BundleReportSchema>, head: z.infer<typeof BundleReportSchema>): BundleDiff {
  const assets = diffAssets(base.assets, head.assets);
  const packages = diffPackages(base.sourceMapAnalysis?.topPackages ?? [], head.sourceMapAnalysis?.topPackages ?? []);

  return {
    assets,
    packages,
    summary: {
      assetCountDelta: head.assets.length - base.assets.length,
      changedAssetCount: assets.filter((asset) => asset.status !== 'unchanged').length,
      gzipDeltaBytes: head.summary.totalGzipBytes - base.summary.totalGzipBytes,
      packageAttribution: packages.length > 0 ? 'available' : 'unavailable',
      rawDeltaBytes: head.summary.totalRawBytes - base.summary.totalRawBytes,
    },
  };
}

function diffAssets(
  baseAssets: z.infer<typeof BundleAssetSchema>[],
  headAssets: z.infer<typeof BundleAssetSchema>[],
): AssetDelta[] {
  const baseByName = new Map(baseAssets.map((asset) => [asset.name, asset]));
  const headByName = new Map(headAssets.map((asset) => [asset.name, asset]));
  const names = new Set([...baseByName.keys(), ...headByName.keys()]);

  return [...names]
    .map((name) => {
      const base = baseByName.get(name);
      const head = headByName.get(name);
      if (base === undefined && head !== undefined) {
        return { gzipDeltaBytes: head.gzipBytes, name, rawDeltaBytes: head.rawBytes, status: 'added' as const };
      }
      if (base !== undefined && head === undefined) {
        return { gzipDeltaBytes: -base.gzipBytes, name, rawDeltaBytes: -base.rawBytes, status: 'removed' as const };
      }
      if (base === undefined || head === undefined) throw new Error(`Internal diff mismatch for ${name}.`);
      const rawDeltaBytes = head.rawBytes - base.rawBytes;
      const gzipDeltaBytes = head.gzipBytes - base.gzipBytes;
      return {
        gzipDeltaBytes,
        name,
        rawDeltaBytes,
        status: rawDeltaBytes === 0 && gzipDeltaBytes === 0 ? ('unchanged' as const) : ('changed' as const),
      };
    })
    .toSorted((a, b) => Math.abs(b.rawDeltaBytes) - Math.abs(a.rawDeltaBytes));
}

function diffPackages(
  basePackages: { bytes: number; packageName: string }[],
  headPackages: { bytes: number; packageName: string }[],
): PackageDelta[] {
  const baseByName = new Map(basePackages.map((entry) => [entry.packageName, entry]));
  const headByName = new Map(headPackages.map((entry) => [entry.packageName, entry]));
  const names = new Set([...baseByName.keys(), ...headByName.keys()]);

  return [...names]
    .map((packageName) => {
      const base = baseByName.get(packageName);
      const head = headByName.get(packageName);
      if (base === undefined && head !== undefined) {
        return { bytesDelta: head.bytes, packageName, status: 'added' as const };
      }
      if (base !== undefined && head === undefined) {
        return { bytesDelta: -base.bytes, packageName, status: 'removed' as const };
      }
      if (base === undefined || head === undefined)
        throw new Error(`Internal package diff mismatch for ${packageName}.`);
      const bytesDelta = head.bytes - base.bytes;
      return {
        bytesDelta,
        packageName,
        status: bytesDelta === 0 ? ('unchanged' as const) : ('changed' as const),
      };
    })
    .toSorted((a, b) => Math.abs(b.bytesDelta) - Math.abs(a.bytesDelta));
}

function renderMarkdown(diff: BundleDiff): string {
  const changedAssets = diff.assets.filter((asset) => asset.status !== 'unchanged').slice(0, 25);
  const assetRows =
    changedAssets.length === 0
      ? '| unchanged | unchanged | 0.0 KiB | 0.0 KiB |'
      : changedAssets
          .map(
            (asset) =>
              `| \`${asset.name}\` | ${asset.status} | ${formatSignedBytes(asset.rawDeltaBytes)} | ${formatSignedBytes(
                asset.gzipDeltaBytes,
              )} |`,
          )
          .join('\n');
  const changedPackages = diff.packages.filter((entry) => entry.status !== 'unchanged').slice(0, 25);
  const packageRows =
    changedPackages.length === 0
      ? '| unavailable | unavailable | 0.0 KiB |'
      : changedPackages
          .map((entry) => `| \`${entry.packageName}\` | ${entry.status} | ${formatSignedBytes(entry.bytesDelta)} |`)
          .join('\n');

  return `# Vite Bundle Diff

- Raw delta: ${formatSignedBytes(diff.summary.rawDeltaBytes)}
- Gzip delta: ${formatSignedBytes(diff.summary.gzipDeltaBytes)}
- Asset count delta: ${diff.summary.assetCountDelta}
- Changed assets: ${diff.summary.changedAssetCount}
- Package attribution: ${diff.summary.packageAttribution}

## Asset Deltas

| Asset | Status | Raw delta | Gzip delta |
| --- | --- | --- | --- |
${assetRows}

## Package Deltas

| Package | Status | Source byte delta |
| --- | --- | --- |
${packageRows}
`;
}

function readRequiredOption(name: string): string {
  const value = readOption(name);
  if (value === undefined) throw new Error(`Missing required ${name}.`);
  return value;
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function formatSignedBytes(bytes: number): string {
  const sign = bytes > 0 ? '+' : '';
  return `${sign}${(bytes / 1024).toFixed(1)} KiB`;
}

async function runSelfTest(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rapidraw-bundle-diff-'));
  try {
    const base = {
      assets: [
        { gzipBytes: 50, name: 'index.js', rawBytes: 100 },
        { gzipBytes: 20, name: 'style.css', rawBytes: 40 },
      ],
      sourceMapAnalysis: {
        topPackages: [{ bytes: 75, packageName: 'react' }],
      },
      summary: { totalGzipBytes: 70, totalRawBytes: 140 },
    };
    const head = {
      assets: [
        { gzipBytes: 65, name: 'index.js', rawBytes: 130 },
        { gzipBytes: 10, name: 'lazy.js', rawBytes: 30 },
      ],
      sourceMapAnalysis: {
        topPackages: [
          { bytes: 95, packageName: 'react' },
          { bytes: 40, packageName: 'simple-icons' },
        ],
      },
      summary: { totalGzipBytes: 75, totalRawBytes: 160 },
    };
    const basePath = join(root, 'base.json');
    const headPath = join(root, 'head.json');
    await Promise.all([writeFile(basePath, JSON.stringify(base)), writeFile(headPath, JSON.stringify(head))]);
    const diff = diffReports(await readReport(basePath), await readReport(headPath));
    if (!diff.assets.some((asset) => asset.name === 'lazy.js' && asset.status === 'added')) {
      throw new Error('self-test: added asset missing.');
    }
    if (!diff.assets.some((asset) => asset.name === 'style.css' && asset.status === 'removed')) {
      throw new Error('self-test: removed asset missing.');
    }
    if (!diff.packages.some((entry) => entry.packageName === 'simple-icons' && entry.status === 'added')) {
      throw new Error('self-test: package delta missing.');
    }
    await writeDiff(diff, join(root, 'out'));
    await readFile(join(root, 'out/vite-bundle-diff.json'), 'utf8');
    await readFile(join(root, 'out/vite-bundle-diff.md'), 'utf8');
  } finally {
    await rm(root, { force: true, recursive: true });
  }

  console.log('vite bundle diff self-test ok');
}
