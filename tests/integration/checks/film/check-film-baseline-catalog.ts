import {
  evaluateFilmProfileClaim,
  verifyFilmProfileManifestHash,
} from '../../../../packages/rawengine-schema/src/film/filmProfileRegistrySchemas';
import { getFilmBaselineProfileCatalog } from '../../../../src/utils/film-look/filmBaselineProfiles';

const catalog = getFilmBaselineProfileCatalog();
if (catalog.length !== 5) throw new Error(`Expected five baseline profiles, got ${catalog.length}`);
const ids = new Set(catalog.map((profile) => profile.profile.id));
if (ids.size !== catalog.length) throw new Error('Baseline profile IDs must be unique.');
for (const profile of catalog) {
  if (profile.claim.class !== 'generic_engineered' || profile.calibration.status !== 'engineered')
    throw new Error(`${profile.profile.id} must be explicitly engineered.`);
  if (evaluateFilmProfileClaim(profile).status !== 'allowed')
    throw new Error(`${profile.profile.id} did not pass the generic claim policy.`);
  if (profile.profile.id !== 'rapidraw.reference_film.v1' && !(await verifyFilmProfileManifestHash(profile)))
    throw new Error(`${profile.profile.id} hash is not reproducible.`);
  if (profile.model.characteristicCurve && profile.model.characteristicCurve.responseKnots.length < 5)
    throw new Error(`${profile.profile.id} characteristic curve is underspecified.`);
}
const families = new Set(catalog.map((profile) => profile.presentation.family));
for (const family of ['generic', 'color_negative', 'reversal', 'cinema_print', 'monochrome']) {
  if (!families.has(family as (typeof catalog)[number]['presentation']['family']))
    throw new Error(`Missing baseline family ${family}.`);
}
console.log('film baseline catalog ok');
