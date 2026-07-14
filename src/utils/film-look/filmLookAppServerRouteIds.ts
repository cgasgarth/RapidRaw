export const FilmLookAppServerCommandName = {
  ApplyFilmEmulationOperation: 'edit.apply_film_emulation_operation',
  BuildAdjustmentPatch: 'film.look.build_adjustment_patch',
} as const;

export const FilmLookAppServerRouteStatus = {
  Mapped: 'mapped',
} as const;

export const FilmLookAppServerSchemaName = {
  FilmOperation: 'FilmEmulationOperationV1',
  FilmOperationResult: 'FilmEmulationOperationResultV1',
  Command: 'FilmLookAppServerCommandV1',
  PatchResult: 'FilmLookAppServerPatchResultV1',
} as const;
