#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { librarySessionSetSchema, parseLibrarySessionSet } from '../src/schemas/librarySessionSchemas.ts';

const validSessionSetPath = 'fixtures/library/library-sessions.json';
const invalidCasesPath = 'fixtures/library/invalid-library-session-cases.json';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const sessionSet = parseLibrarySessionSet(await readJson(validSessionSetPath));
const invalidCases = await readJson(invalidCasesPath);
const failures = [];

for (const session of sessionSet.sessions) {
  if (session.workflowStage === 'export' && session.exportRecipeIds.length === 0) {
    failures.push(`${session.id} is in export stage without export recipes.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = librarySessionSetSchema.safeParse(invalidCase.sessionSet);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

if (failures.length > 0) {
  console.error('Library session fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${sessionSet.sessions.length} library sessions and ${invalidCases.length} invalid cases.`);
