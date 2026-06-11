import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ASSET_BUDGETS = [
  {
    extension: '.js',
    label: 'largest JavaScript asset',
    maxBytes: 2_650_000,
  },
  {
    extension: '.css',
    label: 'largest CSS asset',
    maxBytes: 125_000,
  },
];

const assetsDir = new URL('../dist/assets/', import.meta.url);

const formatBytes = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const entries = await readdir(assetsDir, { withFileTypes: true });
const files = await Promise.all(
  entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const filePath = join(assetsDir.pathname, entry.name);
      const fileStat = await stat(filePath);
      return {
        extension: extname(entry.name),
        name: entry.name,
        size: fileStat.size,
      };
    }),
);

const failures = [];

for (const budget of ASSET_BUDGETS) {
  const matchingFiles = files.filter((file) => file.extension === budget.extension);
  const largest = matchingFiles.toSorted((a, b) => b.size - a.size)[0];

  if (!largest) {
    failures.push(`${budget.label}: no ${budget.extension} files found in dist/assets`);
    continue;
  }

  const line = `${budget.label}: ${largest.name} is ${formatBytes(largest.size)} / ${formatBytes(budget.maxBytes)}`;
  console.log(line);

  if (largest.size > budget.maxBytes) {
    failures.push(line);
  }
}

if (failures.length > 0) {
  console.error('\nBundle budget exceeded:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
