#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  compareSurveyPickExportHandoffSchema,
  compareSurveySessionSchema,
  parseCompareSurveyPickExportHandoff,
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

const pickExportHandoff = parseCompareSurveyPickExportHandoff({
  editGraphRevision: 'edit_graph_compare_selects_dsc_0002_rev_001',
  editorOpenedPath: session.activePath,
  exportEditGraphRevision: 'edit_graph_compare_selects_dsc_0002_rev_001',
  exportJobId: 'export-dsc-0002-current-edit-tiff16',
  exportRecipeId: 'archive-tiff',
  exportStatus: 'queued',
  pickedPath: session.activePath,
  selectionContext: 'compare_survey_pick',
  sessionId: session.id,
  sourceMode: 'survey',
  version: 1,
});
if (pickExportHandoff.editorOpenedPath !== session.activePath) {
  failures.push('Compare/survey handoff did not preserve active pick path.');
}

for (const invalidHandoff of [
  { ...pickExportHandoff, editorOpenedPath: '/Users/example/Pictures/Selects/DSC_9999.NEF' },
  { ...pickExportHandoff, exportEditGraphRevision: 'edit_graph_stale_revision' },
]) {
  const result = compareSurveyPickExportHandoffSchema.safeParse(invalidHandoff);
  if (result.success) {
    failures.push('Invalid compare/survey pick export handoff unexpectedly passed.');
  }
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
