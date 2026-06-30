#!/usr/bin/env bun

import { z } from 'zod';

import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  applyFilmLookAbCommandToAdjustments,
  buildFilmLookAbCommand,
  type FilmLookColorPipelinePixel,
  filmLookAbCommandSchema,
} from '../../../src/utils/film-look/filmLookColorPipelineCommand.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/film-look/filmLookRegistry.ts';

const proofSchema = z
  .object({
    acceptedAfterHash: z.string().regex(/^rawengine-pixel-hash:[a-f0-9]{16}$/u),
    acceptedLookId: z.literal('film_look.generic.warm_print.v1'),
    rejectedLookId: z.literal('film_look.generic.cool_contrast.v1'),
    changedPixelRatio: z.number().min(0.9).max(1),
    commandType: z.literal('filmLook.applyAbCandidate'),
    previewExportParity: z.literal(true),
    replayedFilmLookStrength: z.literal(65),
    replayedLookId: z.literal('film_look.generic.warm_print.v1'),
  })
  .strict();

function makeColorPipelineScene(): Array<FilmLookColorPipelinePixel> {
  const pixels: Array<FilmLookColorPipelinePixel> = [];
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 18; x += 1) {
      const ramp = x / 17;
      const row = y / 8;
      pixels.push({
        b: roundChannel(ramp * 0.68 + row * 0.11 + 0.05),
        g: roundChannel(ramp * 0.78 + (1 - row) * 0.08 + 0.04),
        r: roundChannel(ramp * 0.88 + row * 0.13 + 0.03),
        x,
        y,
      });
    }
  }
  return pixels;
}

const looksById = new Map(FILM_LOOK_BROWSER_ITEMS.map((look) => [look.id, look]));
const acceptedLook = looksById.get('film_look.generic.warm_print.v1');
const rejectedLook = looksById.get('film_look.generic.cool_contrast.v1');

if (acceptedLook === undefined || rejectedLook === undefined) {
  throw new Error('Film look A/B proof fixtures are missing registry looks.');
}

const command = buildFilmLookAbCommand({
  acceptedSlot: 'a',
  actorSessionId: 'film-look-ab-proof-session',
  candidateA: acceptedLook,
  candidateB: rejectedLook,
  expectedGraphRevision: 'graph_rev_film_ab_001',
  imagePath: '/private/raws/film-look-ab-proof.dng',
  operationId: 'proof_001',
  sourcePixels: makeColorPipelineScene(),
  strengthA: 65,
  strengthB: 60,
});
const parsedCommand = filmLookAbCommandSchema.parse(command);
const acceptedSlot = parsedCommand.parameters.candidates[parsedCommand.parameters.acceptedSlot];
const rejectedSlot = parsedCommand.parameters.candidates.b;

if (acceptedSlot.afterHash === rejectedSlot.afterHash) {
  throw new Error('A/B candidates must render distinct output hashes.');
}

if (acceptedSlot.previewHash !== acceptedSlot.afterHash || rejectedSlot.previewHash !== rejectedSlot.afterHash) {
  throw new Error('Film look A/B preview/export parity failed.');
}

const replayedAdjustments = applyFilmLookAbCommandToAdjustments(INITIAL_ADJUSTMENTS, parsedCommand, looksById);
const proof = proofSchema.parse({
  acceptedAfterHash: acceptedSlot.afterHash,
  acceptedLookId: acceptedSlot.lookId,
  changedPixelRatio: acceptedSlot.changedPixelRatio,
  commandType: parsedCommand.commandType,
  previewExportParity: acceptedSlot.previewHash === acceptedSlot.afterHash,
  rejectedLookId: rejectedSlot.lookId,
  replayedFilmLookStrength: replayedAdjustments.filmLookStrength,
  replayedLookId: replayedAdjustments.filmLookId,
});

console.log(`film look ab color pipeline ok (${proof.changedPixelRatio} changed)`);

function roundChannel(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(6));
}
