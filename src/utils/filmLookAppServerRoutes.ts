import {
  type FilmLookAppServerCommand,
  type FilmLookAppServerPatchResult,
  filmLookAppServerCommandSchema,
  filmLookAppServerPatchResultSchema,
  filmLookAppServerRouteManifestSchema,
} from '../schemas/filmLookAppServerSchemas';
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
      generatedFrom: 'src/utils/filmLookBrowser.ts',
    },
    strength: parsedCommand.strength,
  });
};
