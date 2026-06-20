#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  compareSurveySessionSchema,
  parseCompareSurveySession,
  visibleCompareSurveyCandidates,
} from '../../../src/schemas/compareSurveySchemas.ts';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

const session = parseCompareSurveySession(await readJson('fixtures/ui/compare-survey-session.json'));
const invalidCases = z
  .array(z.object({ case: z.string().min(1), session: z.unknown() }).strict())
  .parse(await readJson('fixtures/ui/invalid-compare-survey-cases.json'));
const failures: string[] = [];

const visiblePaths = visibleCompareSurveyCandidates(session).map((candidate) => candidate.path);
const expectedVisiblePaths = [
  '/Users/example/Pictures/Selects/DSC_0001.NEF',
  '/Users/example/Pictures/Selects/DSC_0002.NEF',
];
if (visiblePaths.join('\n') !== expectedVisiblePaths.join('\n')) {
  failures.push(`Unexpected visible compare candidates: ${JSON.stringify(visiblePaths)}.`);
}

for (const invalidCase of invalidCases) {
  const result = compareSurveySessionSchema.safeParse(invalidCase.session);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

if (failures.length > 0) {
  console.error('Compare/survey fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Validated compare/survey session with ${visiblePaths.length} visible candidates and ${invalidCases.length} invalid cases.`,
);
