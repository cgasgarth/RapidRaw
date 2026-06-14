#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  importPresetCatalogSchema,
  parseImportPresetCatalog,
  planImportPreset,
} from '../src/schemas/importPresetSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const catalog = parseImportPresetCatalog(await readJson('fixtures/import/import-presets.json'));
const invalidCases = await readJson('fixtures/import/invalid-import-preset-cases.json');
const failures = [];

const copyPreset = catalog.presets.find((preset) => preset.id === 'wedding-copy-ingest');
if (copyPreset === undefined) {
  failures.push('wedding-copy-ingest preset missing.');
} else {
  const plan = planImportPreset(copyPreset, ['/Volumes/Card/DCIM/DSC_0001.NEF', '/Volumes/Card/DCIM/DSC_0002.NEF']);
  const expectedDestinations = [
    '/Users/example/Pictures/Wedding/RAW/0001_DSC_0001.NEF',
    '/Users/example/Pictures/Wedding/RAW/0002_DSC_0002.NEF',
  ];
  const actualDestinations = plan.map((item) => item.destinationPath);
  if (actualDestinations.join('\n') !== expectedDestinations.join('\n')) {
    failures.push(`Unexpected import destinations: ${JSON.stringify(actualDestinations)}.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = importPresetCatalogSchema.safeParse(invalidCase.catalog);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

if (failures.length > 0) {
  console.error('Import preset fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${catalog.presets.length} import presets and ${invalidCases.length} invalid cases.`);
