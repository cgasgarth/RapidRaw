#!/usr/bin/env bun

import { getFilmBaselineProfileCatalog } from '../../../../src/utils/film-look/filmBaselineProfiles.ts';
import {
  createFilmEmulationTargetState,
  REFERENCE_FILM_PROFILE_REF,
} from '../../../../src/utils/film-look/filmEmulationOperation.ts';
import { FilmLookAppServerCommandName } from '../../../../src/utils/film-look/filmLookAppServerRouteIds.ts';
import {
  applyFilmEmulationAppServerOperation,
  FILM_LOOK_APP_SERVER_ROUTE_MANIFEST,
} from '../../../../src/utils/film-look/filmLookAppServerRoutes.ts';

const route = FILM_LOOK_APP_SERVER_ROUTE_MANIFEST.routes.at(0);
if (
  FILM_LOOK_APP_SERVER_ROUTE_MANIFEST.routes.length !== 1 ||
  route?.commandName !== FilmLookAppServerCommandName.ApplyFilmEmulationOperation
) {
  throw new Error('Film App Server must expose only the current node operation route.');
}

const state = createFilmEmulationTargetState({ kind: 'image', variantId: 'app-server-proof' });
const result = applyFilmEmulationAppServerOperation(
  {
    actor: { id: 'app-server', kind: 'agent', sessionId: 'app-server-proof' },
    approval: { approvalClass: 'edit_apply', reason: 'Current Film profile proof', state: 'approved' },
    commandId: 'film-app-server-proof',
    commandType: 'edit.apply_film_emulation_operation',
    contractVersion: 1,
    correlationId: 'film-app-server-proof',
    dryRun: false,
    expectedGraphRevision: state.graphRevision,
    operation: { kind: 'set_profile', profileRef: REFERENCE_FILM_PROFILE_REF },
    schemaVersion: 1,
    target: state.target,
  },
  state,
);
if (result.resultingNode?.profileRef.contentSha256 !== REFERENCE_FILM_PROFILE_REF.contentSha256) {
  throw new Error('Film App Server did not return the exact pinned current profile.');
}

for (const profile of getFilmBaselineProfileCatalog()) {
  const profileState = createFilmEmulationTargetState({ kind: 'image', variantId: `app-server-${profile.profile.id}` });
  const profileResult = applyFilmEmulationAppServerOperation(
    {
      actor: { id: 'app-server', kind: 'agent', sessionId: 'app-server-proof' },
      approval: { approvalClass: 'edit_apply', reason: 'Current Film profile proof', state: 'approved' },
      commandId: `film-app-server-${profile.profile.id}`,
      commandType: 'edit.apply_film_emulation_operation',
      contractVersion: 1,
      correlationId: `film-app-server-${profile.profile.id}`,
      dryRun: false,
      expectedGraphRevision: profileState.graphRevision,
      operation: { kind: 'set_profile', profileRef: profile.model.profileRef },
      schemaVersion: 1,
      target: profileState.target,
    },
    profileState,
  );
  if (profileResult.resultingNode?.profileRef.contentSha256 !== profile.profile.contentSha256) {
    throw new Error(`Film App Server lost pinned profile identity for ${profile.profile.id}.`);
  }
}

for (const algorithm of [
  'legacy_rapidraw_red_fringe_v0',
  'legacy_rapidraw_glow_bloom_v0',
  'legacy_rapidraw_desaturate_v0',
  'legacy_rapidraw_luma_noise_v0',
]) {
  let rejected = false;
  try {
    applyFilmEmulationAppServerOperation(
      {
        actor: { id: 'app-server', kind: 'agent', sessionId: 'app-server-proof' },
        approval: { approvalClass: 'edit_apply', reason: 'Reject removed Film model', state: 'approved' },
        commandId: `film-app-server-reject-${algorithm}`,
        commandType: 'edit.apply_film_emulation_operation',
        contractVersion: 1,
        correlationId: `film-app-server-reject-${algorithm}`,
        dryRun: false,
        expectedGraphRevision: state.graphRevision,
        operation: { kind: 'set_profile', profileRef: REFERENCE_FILM_PROFILE_REF, algorithm },
        schemaVersion: 1,
        target: state.target,
      },
      state,
    );
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Film App Server accepted removed model identifier ${algorithm}.`);
}

console.log('film app-server route ok (current node operation only; removed model IDs rejected)');
