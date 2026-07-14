#!/usr/bin/env bun

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { findForbiddenStartupDependency } from '../../../scripts/ci/startupEntryDependencyGuard';

interface ManifestChunk {
  dynamicImports?: string[];
  file: string;
  imports?: string[];
  isEntry?: boolean;
  name?: string;
  src?: string;
}

const root = process.argv[2] ?? 'dist';
const indexHtml = await readFile(join(root, 'index.html'), 'utf8');
const prebootMatch = indexHtml.match(/<script data-rawengine-startup-preboot>([\s\S]*?)<\/script>/u);
if (!prebootMatch?.[1]) throw new Error('classic startup preboot missing from production index');
const preboot = prebootMatch[1];
const prebootBytes = Buffer.byteLength(preboot);
if (prebootBytes >= 5_000) throw new Error(`classic startup preboot is ${prebootBytes} bytes; budget is <5000`);
if (/\b(?:React|zod)\b|\bimport\s*\(/iu.test(preboot)) {
  throw new Error('classic startup preboot contains a framework, schema, or module dependency');
}
const startupEntryOffset = indexHtml.search(/<script[^>]+src="[^"]+"/u);
if (startupEntryOffset < 0) throw new Error('startup module script missing from production index');
if (indexHtml.indexOf('data-rawengine-startup-preboot') > startupEntryOffset) {
  throw new Error('module graph starts before the classic startup preboot');
}
const blockingPrefix = indexHtml.slice(0, startupEntryOffset);
if (/<(?:link|script)[^>]+(?:href|src)="https?:\/\//iu.test(blockingPrefix)) {
  throw new Error('startup document has a blocking remote dependency before its module entry');
}
const manifest = JSON.parse(await readFile(join(root, '.vite/manifest.json'), 'utf8')) as Record<string, ManifestChunk>;
const entry = Object.values(manifest).find((chunk) => chunk.isEntry && chunk.src === 'index.html');
if (!entry) throw new Error('startup entry missing from Vite manifest');

const staticGraph = new Map<string, ManifestChunk>();
const visit = (key: string, chunk: ManifestChunk): void => {
  if (staticGraph.has(key)) return;
  staticGraph.set(key, chunk);
  for (const imported of chunk.imports ?? []) {
    const dependency = manifest[imported];
    if (!dependency) throw new Error(`startup static dependency missing from manifest: ${imported}`);
    visit(imported, dependency);
  }
};
const entryKey = Object.entries(manifest).find(([, chunk]) => chunk === entry)?.[0];
if (!entryKey) throw new Error('startup entry key missing from Vite manifest');
visit(entryKey, entry);

const totalBytes = (
  await Promise.all([...staticGraph.values()].map(async ({ file }) => (await stat(join(root, file))).size))
).reduce((sum, size) => sum + size, 0);
if (totalBytes >= 50_000) throw new Error(`startup entry static graph is ${totalBytes} bytes; budget is <50000`);

for (const [key, chunk] of staticGraph) {
  // Vite content hashes are opaque. A hash such as `ZoDX18UC` must not be
  // mistaken for the Zod package; manifest identities retain dependency names.
  const match = findForbiddenStartupDependency(key, chunk);
  if (match) throw new Error(`startup entry statically loads ${match}: ${chunk.file}`);
}
if ((entry.dynamicImports ?? []).length === 0) throw new Error('startup entry does not defer the full application');

console.log(`startup entry ok (${prebootBytes} byte classic preboot; ${totalBytes} byte deferred entry)`);
