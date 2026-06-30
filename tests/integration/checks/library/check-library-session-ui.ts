#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseLibrarySessionSet } from '../../../../src/schemas/library/librarySessionSchemas.ts';
import {
  buildLibrarySessionUiCard,
  buildLibrarySessionUiSummary,
  buildLibrarySessionWorkflowPlan,
  librarySessionUiCardSchema,
} from '../../../../src/schemas/library/librarySessionUiSchemas.ts';

const sessionSetJson: unknown = JSON.parse(await readFile('fixtures/library/library-sessions.json', 'utf8'));
const sessionSet = parseLibrarySessionSet(sessionSetJson);
const activeSession = sessionSet.sessions.find((session) => session.id === sessionSet.activeSessionId);

if (activeSession === undefined) {
  console.error('Active library session fixture is missing.');
  process.exit(1);
}

const card = buildLibrarySessionUiCard(buildLibrarySessionUiSummary(activeSession));
const plan = buildLibrarySessionWorkflowPlan(activeSession);
const parsedCard = librarySessionUiCardSchema.safeParse(card);

if (
  !parsedCard.success ||
  card.assetLabel !== '3 assets' ||
  card.selectedLabel !== '2 selected' ||
  card.recipeLabel !== '1 recipes' ||
  plan.nextAction !== 'review_selection'
) {
  console.error('Library session UI card validation failed.');
  process.exit(1);
}

console.log('library session UI ok');
