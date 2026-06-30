#!/usr/bin/env bun

import { z } from 'zod';
import { FilmLookAppServerCommandName } from '../../../src/utils/film-look/filmLookAppServerRouteIds.ts';
import {
  buildFilmLookAppServerPatchResult,
  FILM_LOOK_APP_SERVER_ROUTE_MANIFEST,
} from '../../../src/utils/film-look/filmLookAppServerRoutes.ts';
import {
  buildFilmLookAppliedAdjustmentPatch,
  buildFilmLookPresetDraft,
  getFilmLookControlledAdjustmentKeys,
} from '../../../src/utils/film-look/filmLookBrowser.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/film-look/filmLookRegistry.ts';

const expectedCommandName = FilmLookAppServerCommandName.BuildAdjustmentPatch;
const runtimeCheckScripts = ['check:film-look-render-apply-proof', 'check:film-look-preview-export-parity'];
const failures = [];
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
    generatedFrom: z.literal('src/utils/film-look/filmLookBrowser.ts'),
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

for (const runtimeCheckScript of runtimeCheckScripts) {
  runPackageScript(runtimeCheckScript);
}

if (failures.length > 0) {
  console.error('Film look app-server route validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`film app-server routes ok (${FILM_LOOK_BROWSER_ITEMS.length} looks)`);

function runPackageScript(scriptName: string): void {
  const result = Bun.spawnSync(['bun', 'run', scriptName], {
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode === 0) return;

  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-20)
    .join('\n');
  failures.push(`${scriptName} failed:\n${output}`);
}
