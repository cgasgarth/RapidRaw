import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Invokes } from '../../../../tauri/commands';
import { createBlobFromUint8Array } from '../../../../utils/blobUtils';
import { buildPresetPreviewAdjustments } from '../../../../utils/editDocumentPreset';
import {
  PresetPreviewAuthority,
  type PresetPreviewIdentity,
  type PresetPreviewImageSession,
  presetPreviewByteResponseSchema,
} from '../../../../utils/presetPreviewContract';
import { invokeWithSchema } from '../../../../utils/tauriSchemaInvoke';
import type { Preset } from '../../../ui/AppProperties';

interface PresetPreviewQueueItem {
  folderId: string | null;
  preset: Preset;
}

export function usePresetPreviewQueue() {
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [previewStates, setPreviewStates] = useState<Record<string, 'failed' | 'idle' | 'loading' | 'ready'>>({});
  const [isGeneratingPreviews, setIsGeneratingPreviews] = useState(false);
  const previewsRef = useRef(previews);
  const previewQueue = useRef<PresetPreviewQueueItem[]>([]);
  const isProcessingQueue = useRef(false);
  const authority = useRef(new PresetPreviewAuthority());

  useLayoutEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  const clearPreviews = useCallback(() => {
    authority.current.invalidatePending();
    Object.values(previewsRef.current).forEach((url) => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    previewsRef.current = {};
    previewQueue.current = [];
    setPreviews({});
    setPreviewStates({});
  }, []);

  const processPreviewQueue = useCallback(async () => {
    if (isProcessingQueue.current || previewQueue.current.length === 0) return;
    isProcessingQueue.current = true;
    setIsGeneratingPreviews(true);

    while (previewQueue.current.length > 0) {
      const item = previewQueue.current.shift();
      if (!item || previewsRef.current[item.preset.id] !== undefined) continue;

      let previewIdentity: PresetPreviewIdentity | null = null;
      try {
        const previewAdjustments = buildPresetPreviewAdjustments(item.preset);
        if (previewAdjustments === null) throw new Error('Preset has invalid edit-document preview authority.');
        const args = authority.current.issue(item.preset.id, previewAdjustments);
        previewIdentity = args.request.previewIdentity;
        const imageData = await invokeWithSchema(Invokes.GeneratePresetPreview, args, presetPreviewByteResponseSchema);
        if (!authority.current.accepts(previewIdentity)) continue;
        const previewUrl = URL.createObjectURL(createBlobFromUint8Array(imageData, 'image/jpeg'));
        setPreviews((current) => {
          const previous = current[item.preset.id];
          if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
          return { ...current, [item.preset.id]: previewUrl };
        });
        setPreviewStates((current) => ({ ...current, [item.preset.id]: 'ready' }));
      } catch (error) {
        console.error(`Failed to generate preview for preset ${item.preset.name}:`, error);
        if (previewIdentity === null || authority.current.accepts(previewIdentity)) {
          setPreviews((current) => ({ ...current, [item.preset.id]: null }));
          setPreviewStates((current) => ({ ...current, [item.preset.id]: 'failed' }));
        }
      }
    }

    isProcessingQueue.current = false;
    setIsGeneratingPreviews(false);
  }, []);

  const enqueuePreviews = useCallback(
    (items: PresetPreviewQueueItem[]) => {
      const newItems = items.filter((item) => previewsRef.current[item.preset.id] === undefined);
      if (newItems.length === 0) return;
      previewQueue.current.push(...newItems);
      setPreviewStates((current) => ({
        ...current,
        ...Object.fromEntries(newItems.map((item) => [item.preset.id, 'loading' as const])),
      }));
      void processPreviewQueue();
    },
    [processPreviewQueue],
  );

  const installImageSession = useCallback((session: PresetPreviewImageSession | null) => {
    return authority.current.installImageSession(session);
  }, []);

  useEffect(
    () => () => {
      clearPreviews();
      authority.current.installImageSession(null);
      isProcessingQueue.current = false;
    },
    [clearPreviews],
  );

  return { clearPreviews, enqueuePreviews, installImageSession, isGeneratingPreviews, previews, previewStates };
}
