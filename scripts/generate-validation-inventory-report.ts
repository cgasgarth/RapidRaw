#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/validation-inventory-report-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const SELF_TEST = process.argv.includes('--self-test');

const packageJsonSchema = z
  .object({
    scripts: z.record(z.string(), z.string()),
  })
  .passthrough();

const inventoryEntrySchema = z
  .object({
    commandHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    domain: z.string().trim().min(1),
    name: z.string().trim().min(1),
    target: z.string().trim().min(1),
    usage: z.enum(['build', 'check', 'prepare', 'release', 'run', 'utility']),
    workflowReferences: z.array(z.string().trim().min(1)),
  })
  .strict();

const inventoryReportSchema = z
  .object({
    generatedFrom: z.literal('package.json scripts + .github/workflows/*.yml'),
    issue: z.literal(2499),
    reportVersion: z.literal(1),
    scripts: z.array(inventoryEntrySchema).min(1),
    summary: z
      .object({
        byDomain: z.record(z.string(), z.number().int().nonnegative()),
        byTarget: z.record(z.string(), z.number().int().nonnegative()),
        byUsage: z.record(z.string(), z.number().int().nonnegative()),
        totalScripts: z.number().int().positive(),
        workflowReferencedScripts: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

type InventoryEntry = z.infer<typeof inventoryEntrySchema>;

if (SELF_TEST) {
  runSelfTest();
  process.exit(0);
}

const packageJson = packageJsonSchema.parse(JSON.parse(await readFile('package.json', 'utf8')));
const workflowTexts = await readWorkflowTexts('.github/workflows');
const scripts = Object.entries(packageJson.scripts)
  .map(([name, command]) => buildInventoryEntry(name, command, workflowTexts))
  .toSorted((left, right) => left.name.localeCompare(right.name));

const report = inventoryReportSchema.parse({
  generatedFrom: 'package.json scripts + .github/workflows/*.yml',
  issue: 2499,
  reportVersion: 1,
  scripts,
  summary: {
    byDomain: countBy(scripts, (entry) => entry.domain),
    byTarget: countBy(scripts, (entry) => entry.target),
    byUsage: countBy(scripts, (entry) => entry.usage),
    totalScripts: scripts.length,
    workflowReferencedScripts: scripts.filter((entry) => entry.workflowReferences.length > 0).length,
  },
});

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = inventoryReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:validation-inventory:update.`);
  }
}

console.log(`validation inventory ok (${report.summary.totalScripts} scripts)`);

function buildInventoryEntry(name: string, command: string, workflowTexts: Map<string, string>): InventoryEntry {
  return inventoryEntrySchema.parse({
    commandHash: hashText(command),
    domain: inferDomain(name, command),
    name,
    target: inferTarget(command),
    usage: inferUsage(name),
    workflowReferences: workflowReferences(name, workflowTexts),
  });
}

function inferUsage(name: string): InventoryEntry['usage'] {
  if (name.startsWith('check:')) return 'check';
  if (name.startsWith('prepare:')) return 'prepare';
  if (name.startsWith('run:')) return 'run';
  if (name.startsWith('build')) return 'build';
  if (name.startsWith('release:')) return 'release';
  return 'utility';
}

function inferDomain(name: string, command: string): string {
  const value = `${name} ${command}`;
  if (value.includes('raw-open-edit-export')) return 'raw-open-edit-export';
  if (value.includes('negative-lab')) return 'negative-lab';
  if (value.includes('panorama')) return 'panorama';
  if (value.includes('focus')) return 'focus-stacking';
  if (value.includes('super-resolution') || value.includes('sr-')) return 'super-resolution';
  if (value.includes('hdr')) return 'hdr';
  if (value.includes('film')) return 'film-simulation';
  if (value.includes('color') || value.includes('tone')) return 'color';
  if (value.includes('agent') || value.includes('app-server')) return 'agent-app-server';
  if (value.includes('rust') || value.includes('cargo')) return 'rust';
  if (value.includes('schema')) return 'schema';
  if (value.includes('bundle') || value.includes('vite')) return 'frontend-build';
  if (value.includes('i18n')) return 'i18n';
  if (value.includes('license') || value.includes('security') || value.includes('audit')) return 'supply-chain';
  return 'general';
}

function inferTarget(command: string): string {
  if (command.includes('cargo ')) return 'cargo';
  if (command.includes('capture-visual-smoke')) return 'visual-smoke';
  if (command.includes('run-compact-checks')) return 'script-group';
  if (command.includes('run-compact-command')) return 'wrapped-command';
  if (command.includes('tests/integration/checks/')) return 'integration-check';
  if (command.includes('packages/rawengine-schema/scripts/')) return 'schema-script';
  if (command.includes('scripts/')) return 'repo-script';
  if (command.includes('vite ')) return 'vite';
  if (command.includes('eslint')) return 'eslint';
  if (command.includes('prettier')) return 'prettier';
  if (command.includes('tsc ')) return 'tsc';
  return 'other';
}

function workflowReferences(scriptName: string, workflowTexts: Map<string, string>): Array<string> {
  return [...workflowTexts.entries()]
    .filter(([, text]) => text.includes(scriptName))
    .map(([path]) => path)
    .toSorted();
}

async function readWorkflowTexts(path: string): Promise<Map<string, string>> {
  const entries = await readdir(path, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
    .map((entry) => join(path, entry.name))
    .toSorted();
  return new Map(await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')] as const)));
}

function countBy(
  entries: ReadonlyArray<InventoryEntry>,
  selector: (entry: InventoryEntry) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const key = selector(entry);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([left], [right]) => left.localeCompare(right)));
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function runSelfTest(): void {
  const workflowTexts = new Map([['.github/workflows/example.yml', 'run: bun run check:types\n']]);
  const entry = buildInventoryEntry(
    'check:types',
    'bun scripts/run-compact-command.ts --label types -- tsc',
    workflowTexts,
  );
  if (entry.usage !== 'check' || entry.target !== 'wrapped-command' || entry.workflowReferences.length !== 1) {
    throw new Error('validation inventory self-test failed');
  }
  console.log('validation inventory self-test ok');
}
