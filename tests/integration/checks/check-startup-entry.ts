#!/usr/bin/env bun

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

interface ManifestChunk {
  dynamicImports?: string[];
  file: string;
  imports?: string[];
  isEntry?: boolean;
  src?: string;
}

const root = process.argv[2] ?? 'dist';
const manifest = JSON.parse(await readFile(join(root, '.vite/manifest.json'), 'utf8')) as Record<string, ManifestChunk>;
const entry = Object.values(manifest).find((chunk) => chunk.isEntry && chunk.src === 'index.html');
if (!entry) throw new Error('startup entry missing from Vite manifest');

const staticGraph = new Set<string>();
const visit = (chunk: ManifestChunk): void => {
  if (staticGraph.has(chunk.file)) return;
  staticGraph.add(chunk.file);
  for (const imported of chunk.imports ?? []) {
    const dependency = manifest[imported];
    if (!dependency) throw new Error(`startup static dependency missing from manifest: ${imported}`);
    visit(dependency);
  }
};
visit(entry);

const totalBytes = (
  await Promise.all([...staticGraph].map(async (file) => (await stat(join(root, file))).size))
).reduce((sum, size) => sum + size, 0);
if (totalBytes >= 50_000) throw new Error(`startup entry static graph is ${totalBytes} bytes; budget is <50000`);

const forbidden = ['react', 'react-dom', 'zod'];
for (const file of staticGraph) {
  const lowered = file.toLowerCase();
  const match = forbidden.find((dependency) => lowered.includes(dependency));
  if (match) throw new Error(`startup entry statically loads ${match}: ${file}`);
}
if ((entry.dynamicImports ?? []).length === 0) throw new Error('startup entry does not defer the full application');

console.log(`startup entry ok (${totalBytes} bytes, ${staticGraph.size} static chunks)`);
