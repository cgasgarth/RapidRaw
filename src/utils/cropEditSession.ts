import type { EditDocumentNodeParamsV2 } from '../../packages/rawengine-schema/src/editDocumentV2';

export type CropOverlayMode =
  | 'none'
  | 'thirds'
  | 'goldenTriangle'
  | 'goldenSpiral'
  | 'phiGrid'
  | 'armature'
  | 'diagonal';

export interface CropEditDraft {
  readonly baseAdjustmentRevision: number;
  readonly geometry: EditDocumentNodeParamsV2<'geometry'>;
  readonly imageSessionId: string;
  readonly overlayMode: CropOverlayMode;
  readonly overlayRotation: number;
  readonly sourceIdentity: string;
}

export interface CropEditDraftIdentity {
  readonly baseAdjustmentRevision: number;
  readonly imageSessionId: string;
  readonly sourceIdentity: string;
}

export const isCropEditDraftCurrent = (
  draft: CropEditDraft | null,
  identity: CropEditDraftIdentity,
): draft is CropEditDraft =>
  draft !== null &&
  draft.baseAdjustmentRevision === identity.baseAdjustmentRevision &&
  draft.imageSessionId === identity.imageSessionId &&
  draft.sourceIdentity === identity.sourceIdentity;
