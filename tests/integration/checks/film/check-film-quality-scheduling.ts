#!/usr/bin/env bun

import { filmRenderResultV1Schema } from '../../../../packages/rawengine-schema/src/index.ts';
import { buildFilmCacheKeys, FilmRenderScheduler } from '../../../../src/utils/film-look/filmRenderScheduler.ts';

const hash = 'fnv1a64:1111111111111111';
const identity = {
  sourceContentSha256: hash,
  selectedImageId: 'image-1',
  graphRevision: 4,
  upstreamGraphSha256: hash,
  filmNodeSha256: hash,
  compiledProfileSha256: hash,
  executionPlanSha256: hash,
  orientationAndGeometrySha256: hash,
  fullResolutionCoordinatePolicy: 'source_stable_v1',
  quality: 'settled_preview_v1' as const,
  viewOutputSha256: hash,
  cropAndDimensionsSha256: hash,
};
const scheduler = new FilmRenderScheduler();
scheduler.setCurrentIdentity(identity);
const interactive = scheduler.submit({ ...identity, quality: 'interactive_drag_v1' }, 2);
const settled = scheduler.submit(identity, 3);
if (scheduler.takeNext()?.requestId !== settled.requestId)
  throw new Error('Settled preview did not outrank interactive work.');
const keys = buildFilmCacheKeys(identity);
const changedOutputKeys = buildFilmCacheKeys({ ...identity, viewOutputSha256: 'fnv1a64:2222222222222222' });
if (keys.preFilmSceneKey !== changedOutputKeys.preFilmSceneKey || keys.filmFrameKey !== changedOutputKeys.filmFrameKey)
  throw new Error('Output-view mutation invalidated reusable pre-Film/Film work.');
if (keys.displayFrameKey === changedOutputKeys.displayFrameKey)
  throw new Error('Output-view mutation reused display frame.');

const ready = filmRenderResultV1Schema.parse({
  requestId: settled.requestId,
  identity: settled.identity,
  status: 'ready',
  backend: 'cpu',
  outputHash: hash,
  approximationCodes: [],
});
if (scheduler.commit(ready).status !== 'ready') throw new Error('Current settled result was rejected.');
const stale = scheduler.commit({
  ...ready,
  requestId: interactive.requestId,
  identity: { ...identity, graphRevision: 5 },
});
if (stale.status !== 'stale' || stale.rejectionReason !== 'film_render_identity_stale')
  throw new Error('Stale result was allowed to commit.');
console.log('film quality scheduling ok (priority, cache boundaries, stale rejection)');
