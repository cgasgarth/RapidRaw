import {
  applyFilmEmulationOperationV1Schema,
  filmEmulationOperationResultV1Schema,
} from '../../../packages/rawengine-schema/src/film/filmEmulationOperationSchemas';
import { filmLookAppServerRouteManifestSchema } from '../../schemas/filmLookAppServerSchemas';
import { applyFilmEmulationOperation, type FilmEmulationTargetStateV1 } from './filmEmulationOperation';
import {
  FilmLookAppServerCommandName,
  FilmLookAppServerRouteStatus,
  FilmLookAppServerSchemaName,
} from './filmLookAppServerRouteIds';
import { getReferenceFilmProfileClaimDecision } from './filmProfileRegistry';

export const FILM_LOOK_APP_SERVER_ROUTE_MANIFEST = filmLookAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandName: FilmLookAppServerCommandName.ApplyFilmEmulationOperation,
      inputSchemaName: FilmLookAppServerSchemaName.FilmOperation,
      outputSchemaName: FilmLookAppServerSchemaName.FilmOperationResult,
      reason: 'Canonical Film graph operation adapter; result is persisted-node readback.',
      status: FilmLookAppServerRouteStatus.Mapped,
    },
  ],
  schemaVersion: 1,
});

/** Adapter over the #5042 mutator; no patch or client-supplied hash is trusted. */
export const applyFilmEmulationAppServerOperation = (command: unknown, state: FilmEmulationTargetStateV1) => {
  const parsed = applyFilmEmulationOperationV1Schema.parse(command);
  const claimDecision = getReferenceFilmProfileClaimDecision();
  if (claimDecision.status !== 'allowed') {
    throw new Error(`Film profile is not applicable: ${claimDecision.reasonCodes.join(',')}`);
  }
  const applied = applyFilmEmulationOperation(parsed, state);
  return filmEmulationOperationResultV1Schema.parse(applied.result);
};
