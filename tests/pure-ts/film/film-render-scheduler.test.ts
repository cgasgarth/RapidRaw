import { describe, expect, test } from 'bun:test';

import { filmEmulationNodeV1Schema } from '../../../packages/rawengine-schema/src/index';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { REFERENCE_FILM_PROFILE_REF } from '../../../src/utils/film-look/filmEmulationOperation';
import {
  buildFilmCacheKeys,
  buildFilmPreviewRenderIdentity,
  type FilmPreviewRenderIdentityInput,
  FilmRenderScheduler,
} from '../../../src/utils/film-look/filmRenderScheduler';

const enabledFilmNode = filmEmulationNodeV1Schema.parse({
  contractVersion: 1,
  enabled: true,
  mix: 1,
  nodeType: 'film_emulation',
  profileRef: REFERENCE_FILM_PROFILE_REF,
  seedPolicy: 'source_stable_v1',
  workingSpace: 'acescg_linear_v1',
});

const input = (overrides: Partial<FilmPreviewRenderIdentityInput> = {}): FilmPreviewRenderIdentityInput => ({
  adjustmentRevision: 4,
  adjustments: { ...structuredClone(INITIAL_ADJUSTMENTS), filmEmulation: enabledFilmNode },
  backend: 'cpu',
  displayGeneration: 2,
  imageSessionId: 7,
  proofIdentity: null,
  quality: 'settled_preview_v1',
  roi: null,
  sourceImagePath: '/private/source.raw',
  sourceRevision: 3,
  targetResolution: 2048,
  viewportRevision: 11,
  ...overrides,
});

const identity = (overrides: Partial<FilmPreviewRenderIdentityInput> = {}) => {
  const result = buildFilmPreviewRenderIdentity(input(overrides));
  if (result === null) throw new Error('Expected enabled Film node identity.');
  return result;
};

describe('Film render quality scheduling', () => {
  test('builds complete identities and keeps output-only invalidation below the Film frame', () => {
    const base = identity();
    const outputChanged = identity({ displayGeneration: 3, proofIdentity: { profile: 'display-p3' } });
    const baseKeys = buildFilmCacheKeys(base);
    const outputKeys = buildFilmCacheKeys(outputChanged);

    expect(outputChanged.viewOutputSha256).not.toBe(base.viewOutputSha256);
    expect(outputKeys.preFilmSceneKey).toBe(baseKeys.preFilmSceneKey);
    expect(outputKeys.filmFrameKey).toBe(baseKeys.filmFrameKey);
    expect(outputKeys.displayFrameKey).not.toBe(baseKeys.displayFrameKey);
  });

  test('Film, upstream, geometry, quality, and execution mutations cross only valid cache boundaries', () => {
    const baseInput = input();
    const base = identity();
    const baseKeys = buildFilmCacheKeys(base);
    const mixed = identity({
      adjustmentRevision: 5,
      adjustments: {
        ...baseInput.adjustments,
        filmEmulation: { ...enabledFilmNode, mix: 0.5 },
      },
    });
    const upstream = identity({
      adjustmentRevision: 5,
      adjustments: { ...baseInput.adjustments, exposure: 1 },
    });
    const interactive = identity({ quality: 'interactive_drag_v1' });
    const geometry = identity({
      adjustmentRevision: 5,
      adjustments: { ...baseInput.adjustments, rotation: 2 },
      viewportRevision: 12,
    });

    expect(buildFilmCacheKeys(mixed).preFilmSceneKey).toBe(baseKeys.preFilmSceneKey);
    expect(buildFilmCacheKeys(mixed).filmFrameKey).not.toBe(baseKeys.filmFrameKey);
    expect(buildFilmCacheKeys(upstream).preFilmSceneKey).not.toBe(baseKeys.preFilmSceneKey);
    expect(buildFilmCacheKeys(interactive).filmFrameKey).not.toBe(baseKeys.filmFrameKey);
    expect(buildFilmCacheKeys(geometry).preFilmSceneKey).not.toBe(baseKeys.preFilmSceneKey);
  });

  test('a 30-edit burst aborts every older preview lease while export stays isolated', () => {
    const scheduler = new FilmRenderScheduler();
    const exportLease = scheduler.begin({ ...identity(), quality: 'export_full_v1' });
    const leases = Array.from({ length: 30 }, (_, index) =>
      scheduler.begin({ ...identity(), graphRevision: index + 1 }),
    );
    const latest = leases.at(-1);
    if (latest === undefined) throw new Error('Expected the 30-edit burst to produce a latest lease.');

    expect(leases.slice(0, -1).every((lease) => lease.signal.aborted && !scheduler.canCommit(lease))).toBeTrue();
    expect(scheduler.canCommit(latest)).toBeTrue();
    expect(scheduler.canCommit(exportLease)).toBeTrue();
    expect(scheduler.activeCount).toBe(2);
  });

  test('disabled Film bypasses Film scheduling entirely', () => {
    const disabled = buildFilmPreviewRenderIdentity(
      input({ adjustments: { ...input().adjustments, filmEmulation: { ...enabledFilmNode, enabled: false } } }),
    );
    expect(disabled).toBeNull();
  });
});
