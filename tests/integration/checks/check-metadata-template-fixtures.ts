#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  applyMetadataTemplate,
  metadataTemplateCatalogSchema,
  parseMetadataTemplateCatalog,
  parseMetadataTemplateTarget,
} from '../../../src/schemas/metadataTemplateSchemas.ts';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

const catalog = parseMetadataTemplateCatalog(await readJson('fixtures/metadata/metadata-templates.json'));
const target = parseMetadataTemplateTarget(await readJson('fixtures/metadata/metadata-template-target.json'));
const invalidCases = z
  .array(z.object({ case: z.string().min(1), catalog: z.unknown() }).strict())
  .parse(await readJson('fixtures/metadata/invalid-metadata-template-cases.json'));
const failures: string[] = [];

const copyrightTemplate = catalog.templates.find((template) => template.id === 'copyright-client-delivery');
if (copyrightTemplate === undefined) {
  failures.push('copyright-client-delivery template missing.');
} else {
  const applied = applyMetadataTemplate(copyrightTemplate, target);
  if (applied.Artist !== 'RawEngine Studio') failures.push('Artist was not applied.');
  if (!applied.tags.includes('portfolio') || !applied.tags.includes('copyrighted')) {
    failures.push(`Tags were not appended correctly: ${JSON.stringify(applied.tags)}.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = metadataTemplateCatalogSchema.safeParse(invalidCase.catalog);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

if (failures.length > 0) {
  console.error('Metadata template fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${catalog.templates.length} metadata templates and ${invalidCases.length} invalid cases.`);
