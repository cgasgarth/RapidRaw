#!/usr/bin/env bun

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { z } from 'zod';

const CliSchema = z
  .object({
    root: z.string().min(1),
  })
  .strict();

type PayloadFailure = {
  path: string;
  reason: string;
};

const cli = CliSchema.parse({
  root: readOption('--root') ?? 'dist',
});

const policyDoc = 'docs/tooling/frontend/vite-bundle-budget-2026-06-11.md';
const forbiddenNamePatterns = [
  { pattern: /\.map$/iu, reason: 'source map artifact in production dist' },
  {
    pattern: /(?:^|[-_.])(debug|fixture|fixtures|mock|test-data)(?:[-_.]|$)/iu,
    reason: 'debug or fixture-like asset name',
  },
] satisfies { pattern: RegExp; reason: string }[];
const forbiddenTextPatterns = [
  { pattern: /sourceMappingURL=/u, reason: 'source map reference comment' },
  { pattern: /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/u, reason: 'localhost URL in production artifact' },
  { pattern: /\/Users\/[A-Za-z0-9._-]+\//u, reason: 'absolute macOS user path in production artifact' },
  { pattern: /[A-Z]:\\Users\\[A-Za-z0-9._-]+\\/u, reason: 'absolute Windows user path in production artifact' },
] satisfies { pattern: RegExp; reason: string }[];

if (process.argv.includes('--self-test')) {
  await runSelfTest();
  process.exit(0);
}

const failures = await collectFailures(cli.root);
if (failures.length > 0) {
  console.error('production payload check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.path}: ${failure.reason}; see ${policyDoc}`);
  }
  process.exit(1);
}

console.log('production payload check ok');
await mkdir('artifacts/bundle-report', { recursive: true });
const archive = Bun.spawnSync({
  cmd: ['git', 'archive', '--format=zip', '--output=artifacts/bundle-report/rapidraw-source.zip', 'HEAD'],
  stderr: 'inherit',
  stdout: 'inherit',
});
if (archive.exitCode !== 0) throw new Error(`source archive failed with exit code ${archive.exitCode}`);

async function collectFailures(root: string): Promise<PayloadFailure[]> {
  const files = await listFiles(root).catch((error: unknown) => {
    throw new Error(`Unable to scan ${root}. Run bun run build:frontend first. ${formatError(error)}`);
  });
  if (files.length === 0) throw new Error(`No production files found in ${root}. Run bun run build:frontend first.`);

  const failures: PayloadFailure[] = [];
  for (const file of files) {
    const normalizedPath = relative(root, file);
    const nameFailure = forbiddenNamePatterns.find(({ pattern }) => pattern.test(normalizedPath));
    if (nameFailure !== undefined) {
      failures.push({ path: normalizedPath, reason: nameFailure.reason });
      continue;
    }

    if (!isScannableTextPath(normalizedPath)) continue;
    const contents = await readFile(file, 'utf8');
    const textFailure = forbiddenTextPatterns.find(({ pattern }) => pattern.test(contents));
    if (textFailure !== undefined) failures.push({ path: normalizedPath, reason: textFailure.reason });
  }

  return failures;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return listFiles(path);
      if (entry.isFile()) return [path];
      return [];
    }),
  );
  return nested.flat();
}

function isScannableTextPath(path: string): boolean {
  return /\.(?:css|html|js|json|map|svg|txt|xml)$/iu.test(path);
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runSelfTest(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rapidraw-production-payload-'));
  try {
    await mkdir(join(root, 'dist/assets'), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'dist/index.html'), '<script type="module" src="/assets/app.js"></script>'),
      writeFile(join(root, 'dist/assets/app.js'), 'console.log("ok")'),
    ]);
    const cleanFailures = await collectFailures(join(root, 'dist'));
    if (cleanFailures.length !== 0) throw new Error('self-test: clean fixture failed.');

    await Promise.all([
      writeFile(join(root, 'dist/assets/debug-fixture.json'), '{"debug":true}'),
      writeFile(join(root, 'dist/assets/app.js.map'), '{}'),
      writeFile(join(root, 'dist/assets/local.js'), 'fetch("http://localhost:1420")'),
      writeFile(
        join(root, 'dist/assets/map-reference.js'),
        'console.log("map")\n//# sourceMappingURL=map-reference.js.map',
      ),
    ]);
    const failures = await collectFailures(join(root, 'dist'));
    if (!failures.some((failure) => failure.reason.includes('fixture-like'))) {
      throw new Error('self-test: debug fixture name was not rejected.');
    }
    if (!failures.some((failure) => failure.reason.includes('source map artifact'))) {
      throw new Error('self-test: source map artifact was not rejected.');
    }
    if (!failures.some((failure) => failure.reason.includes('localhost'))) {
      throw new Error('self-test: localhost payload was not rejected.');
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }

  console.log('production payload self-test ok');
}
