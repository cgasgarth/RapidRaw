import { z } from 'zod';

import {
  FilmLookAppServerCommandName,
  FilmLookAppServerRouteStatus,
  FilmLookAppServerSchemaName,
} from '../utils/film-look/filmLookAppServerRouteIds';

const filmLookAppServerCommandNameSchema = z.literal(FilmLookAppServerCommandName.ApplyFilmEmulationOperation);

const filmLookAppServerRouteSchema = z
  .object({
    commandName: filmLookAppServerCommandNameSchema,
    inputSchemaName: z.literal(FilmLookAppServerSchemaName.FilmOperation),
    outputSchemaName: z.literal(FilmLookAppServerSchemaName.FilmOperationResult),
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
