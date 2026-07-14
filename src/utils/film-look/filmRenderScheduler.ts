import {
  type FilmRenderQualityV1,
  type FilmRenderRequestV1,
  type FilmRenderResultIdentityV1,
  type FilmRenderResultV1,
  filmRenderRequestV1Schema,
  filmRenderResultIdentityV1Schema,
  filmRenderResultV1Schema,
} from '../../../packages/rawengine-schema/src/index.js';
import { filmEmulationCanonicalHash } from './filmEmulationOperation';

export type FilmCacheKeySet = {
  preFilmSceneKey: string;
  filmFrameKey: string;
  displayFrameKey: string;
  thumbnailKey: string;
};

const qualityPriority: Record<FilmRenderQualityV1, number> = {
  export_full_v1: 4,
  settled_preview_v1: 3,
  interactive_drag_v1: 2,
  profile_thumbnail_v1: 1,
};

export const buildFilmCacheKeys = (identity: FilmRenderResultIdentityV1): FilmCacheKeySet => {
  const preFilmSceneKey = filmEmulationCanonicalHash({
    sourceContentSha256: identity.sourceContentSha256,
    upstreamGraphSha256: identity.upstreamGraphSha256,
    orientationAndGeometrySha256: identity.orientationAndGeometrySha256,
    fullResolutionCoordinatePolicy: identity.fullResolutionCoordinatePolicy,
  });
  const filmFrameKey = filmEmulationCanonicalHash({
    preFilmSceneKey,
    filmNodeSha256: identity.filmNodeSha256,
    compiledProfileSha256: identity.compiledProfileSha256,
    executionPlanSha256: identity.executionPlanSha256,
    quality: identity.quality,
    cropAndDimensionsSha256: identity.cropAndDimensionsSha256,
  });
  const displayFrameKey = filmEmulationCanonicalHash({
    filmFrameKey,
    viewOutputSha256: identity.viewOutputSha256,
    cropAndDimensionsSha256: identity.cropAndDimensionsSha256,
  });
  return {
    preFilmSceneKey,
    filmFrameKey,
    displayFrameKey,
    thumbnailKey: filmEmulationCanonicalHash({
      filmFrameKey,
      quality: 'profile_thumbnail_v1',
      selectedImageId: identity.selectedImageId,
    }),
  };
};

export class FilmRenderScheduler {
  private currentIdentity: FilmRenderResultIdentityV1 | null = null;
  private sequence = 0;
  private queue: FilmRenderRequestV1[] = [];

  setCurrentIdentity(rawIdentity: unknown): FilmRenderResultIdentityV1 {
    const identity = filmRenderResultIdentityV1Schema.parse(rawIdentity);
    this.currentIdentity = identity;
    this.queue = this.queue.filter((request) => this.sameIdentity(request.identity, identity));
    return identity;
  }

  submit(rawIdentity: unknown, priority: number): FilmRenderRequestV1 {
    const identity = filmRenderResultIdentityV1Schema.parse(rawIdentity);
    const request = filmRenderRequestV1Schema.parse({
      requestId: `film-render-${++this.sequence}`,
      identity,
      priority,
    });
    this.queue = this.queue.filter(
      (queued) => queued.identity.quality !== identity.quality || !this.sameIdentity(queued.identity, identity),
    );
    this.queue.push(request);
    return request;
  }

  cancel(requestId: string): void {
    this.queue = this.queue.filter((request) => request.requestId !== requestId);
  }

  takeNext(): FilmRenderRequestV1 | undefined {
    this.queue.sort(
      (left, right) =>
        right.priority - left.priority ||
        qualityPriority[right.identity.quality] - qualityPriority[left.identity.quality],
    );
    return this.queue.shift();
  }

  commit(rawResult: unknown): FilmRenderResultV1 {
    const result = filmRenderResultV1Schema.parse(rawResult);
    if (this.currentIdentity === null || !this.sameIdentity(result.identity, this.currentIdentity))
      return { ...result, status: 'stale', outputHash: undefined, rejectionReason: 'film_render_identity_stale' };
    return result;
  }

  private sameIdentity(left: FilmRenderResultIdentityV1, right: FilmRenderResultIdentityV1): boolean {
    return filmEmulationCanonicalHash(left) === filmEmulationCanonicalHash(right);
  }
}
