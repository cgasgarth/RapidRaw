import {
  buildFilmLookAppliedAdjustmentPatch,
  buildFilmLookPresetDraft,
  FILM_LOOK_BROWSER_ITEMS,
  getFilmLookControlledAdjustmentKeys,
} from './filmLookBrowser';
import {
  filmLookAppServerCommandSchema,
  filmLookAppServerPatchResultSchema,
  filmLookAppServerRouteManifestSchema,
  type FilmLookAppServerCommand,
  type FilmLookAppServerPatchResult,
} from '../schemas/filmLookAppServerSchemas';

export const FILM_LOOK_APP_SERVER_ROUTE_MANIFEST = filmLookAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandName: 'film.look.build_adjustment_patch',
      inputSchemaName: 'FilmLookAppServerCommandV1',
      outputSchemaName: 'FilmLookAppServerPatchResultV1',
      reason:
        'Film-look app-server calls share the UI catalog, strength clamp, controlled-key reset, and preset draft builder.',
      status: 'mapped',
    },
  ],
  schemaVersion: 1,
});

export const buildFilmLookAppServerPatchResult = (command: FilmLookAppServerCommand): FilmLookAppServerPatchResult => {
  const parsedCommand = filmLookAppServerCommandSchema.parse(command);
  const look = FILM_LOOK_BROWSER_ITEMS.find((candidate) => candidate.id === parsedCommand.lookId);

  if (look === undefined) {
    throw new Error(`Unknown film look id: ${parsedCommand.lookId}`);
  }

  return filmLookAppServerPatchResultSchema.parse({
    adjustmentPatch: buildFilmLookAppliedAdjustmentPatch(look, parsedCommand.strength),
    commandName: 'film.look.build_adjustment_patch',
    controlledAdjustmentKeys: getFilmLookControlledAdjustmentKeys(),
    lookId: look.id,
    presetDraft: buildFilmLookPresetDraft(look, parsedCommand.strength),
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/filmLookBrowser.ts',
    },
    strength: parsedCommand.strength,
  });
};
