#!/usr/bin/env bun

import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';

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
  assetsDir: 'dist/assets',
  budgets: [
    {
      extension: '.js',
      label: 'largest JavaScript asset',
      maxBytes: 2_674_000,
      maxGzipBytes: 783_000,
    },
    {
      extension: '.css',
      label: 'largest CSS asset',
      maxBytes: 125_000,
      maxGzipBytes: 20_000,
    },
  ],
});

const assetsDir = new URL(`../${bundleBudget.assetsDir}/`, import.meta.url);

const formatBytes = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

let entries;
try {
  entries = await readdir(assetsDir, { withFileTypes: true });
} catch (error) {
  console.error(`Unable to read ${bundleBudget.assetsDir}. Run the frontend build before checking bundle budget.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const files = await Promise.all(
  entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const filePath = join(assetsDir.pathname, entry.name);
      const [fileStat, contents] = await Promise.all([stat(filePath), readFile(filePath)]);

      return {
        extension: extname(entry.name),
        gzipSize: gzipSync(contents).byteLength,
        name: entry.name,
        size: fileStat.size,
      };
    }),
);

const failures = [];

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

if (failures.length > 0) {
  console.error('\nBundle budget exceeded:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Bundle budget passed.');
