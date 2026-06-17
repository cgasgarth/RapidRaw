#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  buildFilmLookAppServerPatchResult,
  FILM_LOOK_APP_SERVER_ROUTE_MANIFEST,
} from '../src/utils/filmLookAppServerRoutes.ts';
import {
  buildFilmLookAppliedAdjustmentPatch,
  buildFilmLookPresetDraft,
  FILM_LOOK_BROWSER_ITEMS,
  getFilmLookControlledAdjustmentKeys,
} from '../src/utils/filmLookBrowser.ts';

const expectedCommandName = 'film.look.build_adjustment_patch';
const route = FILM_LOOK_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedCommandName,
);

if (route === undefined) {
  throw new Error(`Missing film app-server route for ${expectedCommandName}.`);
}

const resultSchema = z.object({
  adjustmentPatch: z.record(z.string(), z.number()),
  commandName: z.literal(expectedCommandName),
  controlledAdjustmentKeys: z.array(z.string()).min(1),
  lookId: z.string(),
  presetDraft: z.object({
    adjustments: z.record(z.string(), z.number()),
    includeCropTransform: z.literal(false),
    includeMasks: z.literal(false),
    name: z.string(),
    presetType: z.literal('style'),
  }),
  proof: z.object({
    deterministic: z.literal(true),
    generatedFrom: z.literal('src/utils/filmLookBrowser.ts'),
  }),
  strength: z.literal(100),
});

for (const look of FILM_LOOK_BROWSER_ITEMS) {
  const result = resultSchema.parse(buildFilmLookAppServerPatchResult({ lookId: look.id, strength: 100 }));

  if (JSON.stringify(result.adjustmentPatch) !== JSON.stringify(buildFilmLookAppliedAdjustmentPatch(look, 100))) {
    throw new Error(`${look.displayName} app-server patch does not match UI apply helper.`);
  }

  if (JSON.stringify(result.presetDraft) !== JSON.stringify(buildFilmLookPresetDraft(look, 100))) {
    throw new Error(`${look.displayName} app-server preset draft does not match UI preset helper.`);
  }

  if (JSON.stringify(result.controlledAdjustmentKeys) !== JSON.stringify(getFilmLookControlledAdjustmentKeys())) {
    throw new Error(`${look.displayName} app-server controlled keys do not match UI helper.`);
  }
}

const sourceChecks = [
  ['src/utils/filmLookAppServerRoutes.ts', 'buildFilmLookAppServerPatchResult'],
  ['src/schemas/filmLookAppServerSchemas.ts', 'filmLookAppServerPatchResultSchema'],
  ['src/utils/filmLookBrowser.ts', 'getFilmLookControlledAdjustmentKeys'],
];

for (const [filePath, marker] of sourceChecks) {
  const source = await readFile(filePath, 'utf8');
  if (!source.includes(marker)) {
    throw new Error(`${filePath} is missing app-server parity marker ${marker}.`);
  }
}

console.log(`film app-server routes ok (${FILM_LOOK_BROWSER_ITEMS.length} looks)`);
