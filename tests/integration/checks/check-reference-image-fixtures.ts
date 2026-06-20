#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  parseReferenceImageWorkspace,
  referenceImageWorkspaceSchema,
  referenceWorkspaceSummary,
} from '../../../src/schemas/referenceImageSchemas.ts';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

const workspace = parseReferenceImageWorkspace(await readJson('fixtures/ui/reference-image-workspace.json'));
const invalidCases = z
  .array(z.object({ case: z.string().min(1), workspace: z.unknown() }).strict())
  .parse(await readJson('fixtures/ui/invalid-reference-image-cases.json'));
const failures: string[] = [];

const summary = referenceWorkspaceSummary(workspace);
if (summary !== 'side_by_side:right:reference-client-grade:2') {
  failures.push(`Unexpected reference workspace summary: ${summary}.`);
}

for (const invalidCase of invalidCases) {
  const result = referenceImageWorkspaceSchema.safeParse(invalidCase.workspace);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

if (failures.length > 0) {
  console.error('Reference image fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Validated reference workspace with ${workspace.references.length} references and ${invalidCases.length} invalid cases.`,
);
