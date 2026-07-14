import {
  evaluateFilmProfileClaim,
  filmProfileManifestV1Schema,
} from '../../../../packages/rawengine-schema/src/film/filmProfileRegistrySchemas';
import { buildFilmProfileFixture } from './film-profile-registry-fixture';

const manifest = buildFilmProfileFixture();
if (filmProfileManifestV1Schema.parse(manifest).profile.id !== 'rapidraw.reference_film.v1')
  throw new Error('Reference profile must parse through canonical manifest schema.');
if (evaluateFilmProfileClaim(manifest).status !== 'allowed')
  throw new Error('Verified generic profile must be runtime-applicable.');
console.log('film profile registry ok');
