import { useCallback, useMemo, useRef } from 'react';

import { useEditorStore } from '../../store/useEditorStore';
import {
  buildCameraInputEditTransaction,
  type CameraInputCommitIdentity,
  type CameraInputParameters,
  type CameraInputPatch,
} from '../../utils/cameraInputEditTransaction';

type CameraInputPatchUpdate = CameraInputPatch | ((current: Readonly<CameraInputParameters>) => CameraInputPatch);

export const useCameraInputEditCommit = (enabled = true) => {
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const identity = useMemo<CameraInputCommitIdentity | null>(
    () =>
      enabled && selectedImagePath !== null
        ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
        : null,
    [adjustmentRevision, enabled, imageSessionId, selectedImagePath],
  );
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const commitCameraInput = useCallback(
    (update: CameraInputPatchUpdate) => {
      const currentIdentity = identityRef.current;
      if (currentIdentity === null) return null;
      const state = useEditorStore.getState();
      const patch = typeof update === 'function' ? update(state.adjustmentSnapshot.value) : update;
      const result = applyEditTransaction(
        buildCameraInputEditTransaction(state, currentIdentity, patch, crypto.randomUUID()),
      );
      identityRef.current = { ...currentIdentity, adjustmentRevision: result.nextAdjustmentRevision };
      return result;
    },
    [applyEditTransaction],
  );
  return { commitCameraInput, commitIdentity: identity };
};
