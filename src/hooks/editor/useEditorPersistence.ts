import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'react-toastify';

import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { type Adjustments, COPYABLE_ADJUSTMENT_KEYS } from '../../utils/adjustments';
import { EditorPersistenceEffectRunner } from '../../utils/editorPersistenceEffectRunner';
import { registerEditorPersistenceBarrierAdapter } from '../../utils/editorPersistenceService';
import { formatUnknownError } from '../../utils/errorFormatting';
import { globalImageCache } from '../../utils/ImageLRUCache';
import { acceptReferenceMatchAdjustmentTransfer } from '../../utils/referenceMatchTransfer';

export interface PreviousAdjustments {
  adjustments: Adjustments;
  path: string;
}

export function useEditorPersistence(prevAdjustmentsRef: React.RefObject<PreviousAdjustments | null>): void {
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const adjustments = useEditorStore((state) => state.adjustments);
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const imageSession = useEditorStore((state) => state.imageSession);
  const imageSessionId = useEditorStore((state) => state.imageSessionId);
  const interactionActive = useEditorStore((state) => state.isSliderDragging);
  const receipt = useEditorStore((state) => state.lastEditApplicationReceipt);
  const multiSelectedPaths = useLibraryStore((state) => state.multiSelectedPaths);
  const includedAdjustments = useSettingsStore(
    (state) => state.appSettings?.copyPasteSettings?.includedAdjustments ?? COPYABLE_ADJUSTMENT_KEYS,
  );
  const runnerRef = useRef<EditorPersistenceEffectRunner | null>(null);
  const runner =
    runnerRef.current ??
    new EditorPersistenceEffectRunner({
      onAccepted: (execution) => {
        const affected = [execution.path, ...(execution.multiSelection?.paths ?? [])];
        for (const path of execution.multiSelection?.paths ?? []) globalImageCache.delete(path);
        useProcessStore.getState().invalidateThumbnails(affected);
      },
      onCurrentFailure: (error) => {
        console.error('Auto-save failed:', error);
        toast.error(`Failed to save changes: ${formatUnknownError(error)}`);
      },
      onSnapshot: (snapshot) => {
        prevAdjustmentsRef.current = snapshot;
      },
    });
  runnerRef.current = runner;

  const multiSelection = useMemo(() => {
    if (!selectedImage?.path) return null;
    const paths = multiSelectedPaths.filter((path) => path !== selectedImage.path);
    const previous = prevAdjustmentsRef.current;
    if (paths.length === 0 || previous?.path !== selectedImage.path) return null;
    const delta: Partial<Adjustments> = {};
    for (const key of Object.keys(adjustments) as Array<keyof Adjustments>) {
      if (
        includedAdjustments.includes(key as string) &&
        JSON.stringify(adjustments[key]) !== JSON.stringify(previous.adjustments[key])
      ) {
        Object.assign(delta, { [key]: adjustments[key] });
      }
    }
    if (Object.keys(delta).length === 0) return null;
    return {
      adjustments: acceptReferenceMatchAdjustmentTransfer({
        adjustments: delta,
        transferMode: 'batch-sync',
      }).adjustments,
      paths,
    };
  }, [adjustments, includedAdjustments, multiSelectedPaths, prevAdjustmentsRef, selectedImage?.path]);

  useEffect(() => {
    if (!selectedImage?.isReady || imageSession === null) return;
    runner.submit({
      adjustmentRevision,
      adjustments,
      baselineHint: prevAdjustmentsRef.current,
      imageSessionId: imageSession.id,
      interactionActive,
      multiSelection,
      path: selectedImage.path,
      receipt,
      sessionGeneration: imageSessionId,
    });
  }, [
    adjustmentRevision,
    adjustments,
    imageSession,
    imageSessionId,
    interactionActive,
    multiSelection,
    prevAdjustmentsRef,
    receipt,
    runner,
    selectedImage?.isReady,
    selectedImage?.path,
  ]);

  useEffect(() => {
    const unregisterBarrierAdapter = registerEditorPersistenceBarrierAdapter(() => runner.cancelQueuedForBarrier());
    return () => {
      unregisterBarrierAdapter();
      runner.cancel();
    };
  }, [runner]);
}
