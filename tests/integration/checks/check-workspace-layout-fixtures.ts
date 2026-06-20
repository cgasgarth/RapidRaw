#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  parseWorkspaceLayoutCatalog,
  visiblePanelsForLayout,
  workspaceLayoutCatalogSchema,
} from '../../../src/schemas/workspaceLayoutSchemas.ts';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

const catalog = parseWorkspaceLayoutCatalog(await readJson('fixtures/ui/workspace-layouts.json'));
const invalidCases = z
  .array(z.object({ case: z.string().min(1), catalog: z.unknown() }).strict())
  .parse(await readJson('fixtures/ui/invalid-workspace-layout-cases.json'));
const failures: string[] = [];

const denseLayout = catalog.layouts.find((layout) => layout.id === 'capture-cull-dense');
if (denseLayout === undefined) {
  failures.push('capture-cull-dense layout missing.');
} else {
  const visiblePanelIds = visiblePanelsForLayout(denseLayout).map((panel) => panel.id);
  if (visiblePanelIds.join(',') !== 'library,metadata,export') {
    failures.push(`Unexpected visible panel order: ${visiblePanelIds.join(',')}.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = workspaceLayoutCatalogSchema.safeParse(invalidCase.catalog);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

if (failures.length > 0) {
  console.error('Workspace layout fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${catalog.layouts.length} workspace layouts and ${invalidCases.length} invalid cases.`);
