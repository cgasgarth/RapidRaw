import {
  applyFilmEmulationOperationV1Schema,
  filmEmulationOperationResultV1Schema,
} from '../../../packages/rawengine-schema/src/film/filmEmulationOperationSchemas';
import {
  type FilmLookAppServerCommand,
  type FilmLookAppServerPatchResult,
  filmLookAppServerCommandSchema,
  filmLookAppServerPatchResultSchema,
  filmLookAppServerRouteManifestSchema,
} from '../../schemas/filmLookAppServerSchemas';
import { applyFilmEmulationOperation, type FilmEmulationTargetStateV1 } from './filmEmulationOperation';
import {
  FilmLookAppServerCommandName,
  FilmLookAppServerRouteStatus,
  FilmLookAppServerSchemaName,
} from './filmLookAppServerRouteIds';
import {
  buildFilmLookAppliedAdjustmentPatch,
  buildFilmLookPresetDraft,
  getFilmLookControlledAdjustmentKeys,
} from './filmLookBrowser';
import { FILM_LOOK_BROWSER_ITEMS } from './filmLookRegistry';

export const FILM_LOOK_APP_SERVER_ROUTE_MANIFEST = filmLookAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandName: FilmLookAppServerCommandName.ApplyFilmEmulationOperation,
      inputSchemaName: FilmLookAppServerSchemaName.FilmOperation,
      outputSchemaName: FilmLookAppServerSchemaName.FilmOperationResult,
      reason: 'Canonical Film graph operation adapter; result is persisted-node readback.',
      status: FilmLookAppServerRouteStatus.Mapped,
    },
    {
      commandName: FilmLookAppServerCommandName.BuildAdjustmentPatch,
      inputSchemaName: FilmLookAppServerSchemaName.Command,
      outputSchemaName: FilmLookAppServerSchemaName.PatchResult,
      reason:
        'Film-look app-server calls share the UI catalog, strength clamp, controlled-key reset, and preset draft builder.',
      status: FilmLookAppServerRouteStatus.Mapped,
    },
  ],
  schemaVersion: 1,
});

/** Adapter over the #5042 mutator; no patch or client-supplied hash is trusted. */
export const applyFilmEmulationAppServerOperation = (command: unknown, state: FilmEmulationTargetStateV1) => {
  const parsed = applyFilmEmulationOperationV1Schema.parse(command);
  const applied = applyFilmEmulationOperation(parsed, state);
  return filmEmulationOperationResultV1Schema.parse(applied.result);
};

export const buildFilmLookAppServerPatchResult = (command: FilmLookAppServerCommand): FilmLookAppServerPatchResult => {
  const parsedCommand = filmLookAppServerCommandSchema.parse(command);
  const look = FILM_LOOK_BROWSER_ITEMS.find((candidate) => candidate.id === parsedCommand.lookId);

  if (look === undefined) {
    throw new Error(`Unknown film look id: ${parsedCommand.lookId}`);
  }

  return filmLookAppServerPatchResultSchema.parse({
    adjustmentPatch: buildFilmLookAppliedAdjustmentPatch(look, parsedCommand.strength),
    commandName: FilmLookAppServerCommandName.BuildAdjustmentPatch,
    controlledAdjustmentKeys: getFilmLookControlledAdjustmentKeys(),
    lookId: look.id,
    presetDraft: buildFilmLookPresetDraft(look, parsedCommand.strength),
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/film-look/filmLookBrowser.ts',
    },
    strength: parsedCommand.strength,
  });
};
