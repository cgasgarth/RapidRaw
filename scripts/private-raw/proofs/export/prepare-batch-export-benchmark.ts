#!/usr/bin/env bun

/**
 * Build a deterministic, private-only mixed-resolution export benchmark manifest.
 * This script never launches RapidRaw and never writes into the repository. The
 * native proof runner consumes the manifest after the app slot is available.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

type ExifEntry = {
  SourceFile?: string;
  FileName?: string;
  Directory?: string;
  FileSize?: number;
  ImageWidth?: number;
  ImageHeight?: number;
};

type BenchmarkItem = {
  ordinal: number;
  sourcePath: string;
  sourceFormat: 'raw' | 'jpeg' | 'other';
  width: number | null;
  height: number | null;
  megapixels: number | null;
  virtualCopy: number;
};

type BenchmarkManifest = {
  schemaVersion: 1;
  fixtureId: 'export-batch-mixed-alaska-v1';
  generatedAt: string;
  privateRoot: string;
  itemCount: number;
  items: BenchmarkItem[];
  measurementProcedure: {
    rssSampling: string;
    queueMetrics: string;
    throughput: string;
    cancellation: string;
    interactiveLatency: string;
    outputValidation: string;
  };
};

const root = resolve(valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '');
if (root === resolve('')) {
  console.error('RAWENGINE_PRIVATE_RAW_ROOT or --root is required.');
  process.exit(1);
}
const count = Number.parseInt(valueAfter('--count') ?? '100', 10);
if (!Number.isInteger(count) || count < 1 || count > 10_000) {
  console.error('--count must be an integer from 1 to 10000.');
  process.exit(1);
}

const output = resolve(
  valueAfter('--output') ??
    join(root, 'private-artifacts', 'validation', 'export-batch-benchmark', 'mixed-alaska-v1.json'),
);
const rawExtensions = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.raf', '.rw2', '.orf', '.srw']);
const jpegExtensions = new Set(['.jpg', '.jpeg']);

const files = (await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: root, onlyFiles: true })))
  .filter((relative) => {
    const lower = relative.toLowerCase();
    const extension = extname(lower);
    return (
      !lower.includes('.quarantine') &&
      !lower.endsWith('.xmp') &&
      !lower.endsWith('.rrdata') &&
      (rawExtensions.has(extension) || jpegExtensions.has(extension))
    );
  })
  .sort((a, b) => a.localeCompare(b, 'en'));
if (files.length === 0) {
  console.error(`No source images found under ${root}`);
  process.exit(1);
}

const metadata = await readExif(files.map((file) => join(root, file)));
const candidates = metadata
  .map((entry) => {
    const path = resolve(entry.SourceFile ?? join(root, entry.Directory ?? '', entry.FileName ?? ''));
    const extension = extname(path).toLowerCase();
    const format = rawExtensions.has(extension) ? 'raw' : jpegExtensions.has(extension) ? 'jpeg' : 'other';
    const widthValue = entry.ImageWidth;
    const heightValue = entry.ImageHeight;
    const width = finitePositive(widthValue) ? widthValue : null;
    const height = finitePositive(heightValue) ? heightValue : null;
    return {
      path,
      format,
      width,
      height,
      megapixels: width !== null && height !== null ? (width * height) / 1_000_000 : null,
      bytes: entry.FileSize ?? 0,
    };
  })
  .filter((entry) => entry.format !== 'other');

if (candidates.length === 0) {
  console.error('No RAW/JPEG sources found after metadata filtering.');
  process.exit(1);
}

const buckets = [
  candidates.filter((entry) => entry.megapixels !== null && entry.megapixels <= 20),
  candidates.filter((entry) => entry.megapixels !== null && entry.megapixels > 20 && entry.megapixels <= 60),
  candidates.filter((entry) => entry.megapixels !== null && entry.megapixels > 60),
  candidates.filter((entry) => entry.format === 'jpeg'),
  candidates.filter((entry) => entry.format === 'raw'),
].filter((bucket) => bucket.length > 0);
const selected = Array.from({ length: count }, (_, index) => {
  const bucket = buckets[index % buckets.length];
  if (bucket === undefined || bucket.length === 0) throw new Error('benchmark bucket selection failed');
  const item = bucket[index % bucket.length];
  if (item === undefined) throw new Error('benchmark item selection failed');
  return item;
});

const manifest: BenchmarkManifest = {
  schemaVersion: 1,
  fixtureId: 'export-batch-mixed-alaska-v1',
  generatedAt: new Date().toISOString(),
  privateRoot: root,
  itemCount: count,
  items: selected.map((entry, ordinal) => ({
    ordinal,
    sourcePath: entry.path,
    sourceFormat: entry.format,
    width: entry.width,
    height: entry.height,
    megapixels: entry.megapixels,
    virtualCopy: Math.floor(ordinal / Math.max(1, candidates.length)),
  })),
  measurementProcedure: {
    rssSampling:
      'Sample app RSS with ps -o rss= -p <pid> every 500ms from preflight through terminal receipt; record peak and baseline delta in MiB.',
    queueMetrics:
      'Capture BatchExportReport queue peaks, host/gpu credit peaks, oversized count, and interactive preemptions from the terminal manifest/event log.',
    throughput:
      'Record monotonic time from first admitted plan to terminal receipt; report items/minute and p50/p95 item completion intervals.',
    cancellation:
      'Request cancellation after item 20 reaches Rendering; record request-to-EXPORT_CANCELLED latency and verify no temporary artifacts remain.',
    interactiveLatency:
      'While export runs, issue a preview/navigation action every 2s; record p50/p95 acknowledgement latency and export GPU preemptions.',
    outputValidation:
      'Verify each committed output opens, has the requested format/ICC/metadata policy, and matches its source/edit revision in the terminal manifest.',
  },
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`export benchmark manifest written: ${output} (${count} items)`);

async function readExif(paths: string[]): Promise<ExifEntry[]> {
  const entries: ExifEntry[] = [];
  for (let offset = 0; offset < paths.length; offset += 200) {
    const chunk = paths.slice(offset, offset + 200);
    const proc = Bun.spawn(
      ['exiftool', '-j', '-FileName', '-Directory', '-FileSize#', '-ImageWidth', '-ImageHeight', ...chunk],
      { stderr: 'pipe', stdout: 'pipe' },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0 && stdout.trim().length === 0) {
      console.error(stderr.trim() || 'exiftool failed');
      process.exit(exitCode);
    }
    if (exitCode !== 0 && stderr.trim().length > 0) {
      console.warn(`exiftool warnings for chunk ${offset}: ${stderr.trim()}`);
    }
    entries.push(...(JSON.parse(stdout) as ExifEntry[]));
  }
  return entries;
}

function finitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
