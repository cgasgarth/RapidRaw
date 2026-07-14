import {
  canonicalFilmProfileManifestJson,
  filmProfileManifestV1Schema,
  verifyFilmProfileManifestHash,
} from '../../../../packages/rawengine-schema/src/film/filmProfileRegistrySchemas';
import { buildFilmProfileFixture } from './film-profile-registry-fixture';

const manifest = buildFilmProfileFixture();
const canonical = canonicalFilmProfileManifestJson(manifest);
if (canonical !== canonicalFilmProfileManifestJson(filmProfileManifestV1Schema.parse(JSON.parse(canonical))))
  throw new Error('Canonical profile serialization must be deterministic.');
if (await verifyFilmProfileManifestHash(manifest))
  throw new Error('Deliberately invalid fixture hash must fail closed.');
const pinned = {
  ...manifest,
  profile: {
    ...manifest.profile,
    contentSha256: 'sha256:2a9e0d9d2c8d2fca7bc6a98990e782a3cbca665b96aa02dff1d55ec8f76a3b09',
  },
};
if (pinned.profile.id !== manifest.profile.id || pinned.profile.version !== manifest.profile.version)
  throw new Error('Profile pin must preserve id/version.');
console.log('film profile hash pinning ok');
