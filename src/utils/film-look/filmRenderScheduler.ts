import {
  type FilmRenderQualityV1,
  type FilmRenderResultIdentityV1,
  filmRenderResultIdentityV1Schema,
} from '../../../packages/rawengine-schema/src/index.js';
import type { Adjustments } from '../adjustments';
import { filmEmulationCanonicalHash } from './filmEmulationOperation';

export type FilmCacheKeySet = {
  preFilmSceneKey: string;
  filmFrameKey: string;
  displayFrameKey: string;
  thumbnailKey: string;
};

export interface FilmPreviewRenderIdentityInput {
  adjustmentRevision: number;
  adjustments: Readonly<Adjustments>;
  backend: 'cpu' | 'wgpu';
  displayGeneration: number;
  imageSessionId: number;
  proofIdentity: unknown;
  quality: Extract<FilmRenderQualityV1, 'interactive_drag_v1' | 'settled_preview_v1'>;
  roi: readonly [number, number, number, number] | null;
  sourceImagePath: string;
  sourceRevision: number;
  targetResolution: number;
  viewportRevision: number;
}

export interface FilmRenderLease {
  readonly identity: FilmRenderResultIdentityV1;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

interface OwnedFilmRenderLease extends FilmRenderLease {
  readonly controller: AbortController;
  readonly identityHash: string;
  readonly lane: string;
}

const upstreamAdjustments = (adjustments: Readonly<Adjustments>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(adjustments).filter(([key]) => key !== 'filmEmulation'));

export const buildFilmPreviewRenderIdentity = (
  input: FilmPreviewRenderIdentityInput,
): FilmRenderResultIdentityV1 | null => {
  const node = input.adjustments.filmEmulation;
  if (node === null || !node.enabled) return null;

  const sourceContentSha256 = filmEmulationCanonicalHash({
    imageSessionId: input.imageSessionId,
    sourceImagePath: input.sourceImagePath,
    sourceRevision: input.sourceRevision,
  });
  const upstreamGraphSha256 = filmEmulationCanonicalHash(upstreamAdjustments(input.adjustments));
  const filmNodeSha256 = filmEmulationCanonicalHash(node);
  const executionPlanSha256 = filmEmulationCanonicalHash({
    approximationContract:
      input.quality === 'interactive_drag_v1' ? 'film_interactive_approximation_v1' : 'film_complete_stages_v1',
    backend: input.backend,
    contract: 'film_execution_plan_v1',
    profileContentSha256: node.profileRef.contentSha256,
  });
  const orientationAndGeometrySha256 = filmEmulationCanonicalHash({
    crop: input.adjustments.crop,
    flipHorizontal: input.adjustments.flipHorizontal,
    flipVertical: input.adjustments.flipVertical,
    orientationSteps: input.adjustments.orientationSteps,
    rotation: input.adjustments.rotation,
  });
  const viewOutputSha256 = filmEmulationCanonicalHash({
    displayGeneration: input.displayGeneration,
    proofIdentity: input.proofIdentity,
  });
  const cropAndDimensionsSha256 = filmEmulationCanonicalHash({
    crop: input.adjustments.crop,
    roi: input.roi,
    targetResolution: input.targetResolution,
    viewportRevision: input.viewportRevision,
  });

  return filmRenderResultIdentityV1Schema.parse({
    compiledProfileSha256: node.profileRef.contentSha256,
    cropAndDimensionsSha256,
    executionPlanSha256,
    filmNodeSha256,
    fullResolutionCoordinatePolicy: node.seedPolicy,
    graphRevision: input.adjustmentRevision,
    orientationAndGeometrySha256,
    quality: input.quality,
    selectedImageId: `editor-image-session:${String(input.imageSessionId)}`,
    sourceContentSha256,
    upstreamGraphSha256,
    viewOutputSha256,
  });
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

const laneFor = (identity: FilmRenderResultIdentityV1): string => {
  if (identity.quality === 'export_full_v1') return `export:${identity.selectedImageId}`;
  if (identity.quality === 'profile_thumbnail_v1')
    return `thumbnail:${identity.selectedImageId}:${identity.filmNodeSha256}`;
  return `preview:${identity.selectedImageId}`;
};

/** Owns exact-current Film work independently for preview, export, and thumbnail lanes. */
export class FilmRenderScheduler {
  private activeByRequestId = new Map<string, OwnedFilmRenderLease>();
  private currentIdentityHashByLane = new Map<string, string>();
  private sequence = 0;

  begin(rawIdentity: unknown): FilmRenderLease {
    const identity = filmRenderResultIdentityV1Schema.parse(rawIdentity);
    const identityHash = filmEmulationCanonicalHash(identity);
    const lane = laneFor(identity);
    for (const active of this.activeByRequestId.values()) {
      if (active.lane === lane) this.cancel(active);
    }
    const controller = new AbortController();
    const lease: OwnedFilmRenderLease = {
      controller,
      identity,
      identityHash,
      lane,
      requestId: `film-render-${++this.sequence}`,
      signal: controller.signal,
    };
    this.currentIdentityHashByLane.set(lane, identityHash);
    this.activeByRequestId.set(lease.requestId, lease);
    return lease;
  }

  canCommit(lease: FilmRenderLease): boolean {
    const owned = this.activeByRequestId.get(lease.requestId);
    return (
      owned !== undefined &&
      !owned.signal.aborted &&
      owned.identityHash === filmEmulationCanonicalHash(lease.identity) &&
      this.currentIdentityHashByLane.get(owned.lane) === owned.identityHash
    );
  }

  cancel(lease: FilmRenderLease): void {
    const owned = this.activeByRequestId.get(lease.requestId);
    if (owned === undefined) return;
    owned.controller.abort('film_render_superseded');
    this.activeByRequestId.delete(owned.requestId);
  }

  finish(lease: FilmRenderLease): void {
    this.activeByRequestId.delete(lease.requestId);
  }

  get activeCount(): number {
    return this.activeByRequestId.size;
  }
}
