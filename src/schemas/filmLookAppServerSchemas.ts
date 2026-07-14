import { z } from 'zod';

import {
  FilmLookAppServerCommandName,
  FilmLookAppServerRouteStatus,
  FilmLookAppServerSchemaName,
} from '../utils/film-look/filmLookAppServerRouteIds';

export const filmLookAppServerCommandNameSchema = z.union([
  z.literal(FilmLookAppServerCommandName.ApplyFilmEmulationOperation),
  z.literal(FilmLookAppServerCommandName.BuildAdjustmentPatch),
]);

export const filmLookAppServerCommandSchema = z
  .object({
    lookId: z.string().trim().min(1),
    strength: z.number().int().min(0).max(100),
  })
  .strict();

export const filmLookAppServerRouteSchema = z
  .object({
    commandName: filmLookAppServerCommandNameSchema,
    inputSchemaName: z.union([
      z.literal(FilmLookAppServerSchemaName.Command),
      z.literal(FilmLookAppServerSchemaName.FilmOperation),
    ]),
    outputSchemaName: z.union([
      z.literal(FilmLookAppServerSchemaName.PatchResult),
      z.literal(FilmLookAppServerSchemaName.FilmOperationResult),
    ]),
    reason: z.string().trim().min(1),
    status: z.literal(FilmLookAppServerRouteStatus.Mapped),
  })
  .strict();

export const filmLookAppServerRouteManifestSchema = z
  .object({
    routes: z.array(filmLookAppServerRouteSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const filmLookAppServerPatchResultSchema = z
  .object({
    adjustmentPatch: z.record(z.string(), z.number()),
    commandName: filmLookAppServerCommandNameSchema,
    controlledAdjustmentKeys: z.array(z.string().trim().min(1)).min(1),
    lookId: z.string().trim().min(1),
    presetDraft: z
      .object({
        adjustments: z.record(z.string(), z.number()),
        includeCropTransform: z.literal(false),
        includeMasks: z.literal(false),
        name: z.string().trim().min(1),
        presetType: z.literal('style'),
      })
      .strict(),
    proof: z
      .object({
        deterministic: z.literal(true),
        generatedFrom: z.literal('src/utils/film-look/filmLookBrowser.ts'),
      })
      .strict(),
    strength: z.number().int().min(0).max(100),
  })
  .strict();

export type FilmLookAppServerCommand = z.infer<typeof filmLookAppServerCommandSchema>;
export type FilmLookAppServerPatchResult = z.infer<typeof filmLookAppServerPatchResultSchema>;
