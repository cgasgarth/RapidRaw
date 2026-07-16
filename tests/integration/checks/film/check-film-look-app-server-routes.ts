#!/usr/bin/env bun

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

console.log('film app-server route ok (current node operation only)');
