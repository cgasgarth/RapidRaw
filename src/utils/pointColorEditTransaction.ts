import {
  type PointColorPlanV1,
  pointColorPlanV1Schema,
} from '../../packages/rawengine-schema/src/color/pointColorSchemas';
import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentNode } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';

export interface PointColorCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface PointColorEditTransactionState {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

/**
 * Point Color edits are intentionally restricted to the plan's own fields. The
 * schema parse below is the runtime boundary that keeps slider/picker patches
 * from leaking unbounded or unknown values into the edit document.
 */
export type PointColorPatch = Partial<PointColorPlanV1>;

const currentImageSessionId = (state: PointColorEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isCurrentPointColorIdentity = (
  state: PointColorEditTransactionState,
  identity: PointColorCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

export const buildPointColorEditTransaction = (
  state: PointColorEditTransactionState,
  identity: PointColorCommitIdentity,
  patch: PointColorPatch,
  transactionId: string,
  history: EditTransactionRequest['history'] = 'single-entry',
  persistence: EditTransactionRequest['persistence'] = 'commit',
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `point_color_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(`point_color_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`);
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `point_color_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  const currentPlan = selectEditDocumentNode(state.editDocumentV2, 'point_color').params.pointColor;
  const nextPlan = pointColorPlanV1Schema.parse({ ...structuredClone(currentPlan), ...structuredClone(patch) });

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history,
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'point_color',
        patch: {
          pointColor: nextPlan,
        },
        type: 'patch-edit-document-node',
      },
    ],
    persistence,
    source: 'manual-control',
    transactionId,
  };
};
