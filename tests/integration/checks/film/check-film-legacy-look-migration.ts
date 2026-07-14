import { strict as assert } from 'node:assert';

import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildFilmLookAppliedAdjustmentPatch } from '../../../../src/utils/film-look/filmLookBrowser.ts';
import { getFilmLookBrowserGroups, migrateLegacyFilmLook } from '../../../../src/utils/film-look/filmLookRegistry.ts';

const look = getFilmLookBrowserGroups().flatMap((group) => group.looks)[0];
assert(look);
const exact = {
  ...INITIAL_ADJUSTMENTS,
  ...buildFilmLookAppliedAdjustmentPatch(look, look.strengthDefault),
  filmLookId: look.id,
  filmLookStrength: look.strengthDefault,
};
assert.equal(migrateLegacyFilmLook(exact).status, 'migrated_to_film_node');
assert.equal(
  migrateLegacyFilmLook({ ...exact, contrast: exact.contrast + 1 }).status,
  'legacy_controlled_fields_modified',
);
assert.equal(
  migrateLegacyFilmLook({ ...INITIAL_ADJUSTMENTS, filmLookId: 'unknown', filmLookStrength: 50 }).status,
  'legacy_mapping_unavailable',
);

console.log('film legacy look migration contract ok');
