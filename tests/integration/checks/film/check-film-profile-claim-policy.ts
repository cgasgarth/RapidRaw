import { evaluateFilmProfileClaim } from '../../../../packages/rawengine-schema/src/film/filmProfileRegistrySchemas';
import { buildFilmProfileFixture } from './film-profile-registry-fixture';

const valid = buildFilmProfileFixture();
if (evaluateFilmProfileClaim(valid).status !== 'allowed')
  throw new Error('Generic engineered reference profile should be allowed.');
const invalid = buildFilmProfileFixture({ presentation: { ...valid.presentation, displayName: 'Kodak matched' } });
const decision = evaluateFilmProfileClaim(invalid);
if (decision.status !== 'rejected' || !decision.reasonCodes.includes('generic_claim_language'))
  throw new Error('Unsafe generic stock claim must be rejected.');
const withdrawn = buildFilmProfileFixture({ profile: { ...valid.profile, lifecycle: 'withdrawn' } });
if (evaluateFilmProfileClaim(withdrawn).status !== 'unavailable')
  throw new Error('Withdrawn profiles must be unavailable.');
console.log('film profile claim policy ok');
