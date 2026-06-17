import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import { toast } from 'react-toastify';

import { Invokes } from '../components/ui/AppProperties';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  Adjustments,
  INITIAL_ADJUSTMENTS,
  COPYABLE_ADJUSTMENT_KEYS,
  PasteMode,
  LensAdjustment,
  normalizeLoadedAdjustments,
} from '../utils/adjustments';
import {
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  hasBasicToneAdjustmentChange,
} from '../utils/basicToneCommandBridge';
import { calculateCenteredCrop } from '../utils/cropUtils';
import { formatUnknownError } from '../utils/errorFormatting';
import { globalImageCache } from '../utils/ImageLRUCache';
import { debounce } from '../utils/timing';

export const debouncedSetHistory = debounce((newAdj: Adjustments) => {
  useEditorStore.getState().pushHistory(newAdj);
}, 500);

export const debouncedSave = debounce((path: string, adjustmentsToSave: Adjustments) => {
  invoke(Invokes.SaveMetadataAndUpdateThumbnail, { path, adjustments: adjustmentsToSave }).catch((err: unknown) => {
    console.error('Auto-save failed:', err);
    toast.error(`Failed to save changes: ${formatUnknownError(err)}`);
  });
}, 300);

type LoadedMetadataAdjustments = Adjustments & { is_null?: boolean };
type AdjustmentRecord = Record<string, unknown>;

interface MetadataResponse {
  adjustments?: LoadedMetadataAdjustments | null;
}

const cloneAdjustmentValue = (value: unknown): unknown => structuredClone(value);
const BASIC_TONE_SESSION_ID = 'rapidraw-editor-basic-tone';

const createOperationId = (): string => crypto.randomUUID();

export function useEditorActions() {
  const setEditor = useEditorStore((s) => s.setEditor);

  const setAdjustments = useCallback(
    (value: Partial<Adjustments> | ((prev: Adjustments) => Adjustments)) => {
      setEditor((state) => {
        const prev = state.adjustments;
        const newAdjustments = typeof value === 'function' ? value(prev) : { ...prev, ...value };
        const lastBasicToneCommand =
          state.selectedImage?.path && hasBasicToneAdjustmentChange(prev, newAdjustments)
            ? buildBasicToneCommandEnvelope(
                newAdjustments,
                buildBasicToneImageCommandContext({
                  expectedGraphRevision: `history_${state.historyIndex}`,
                  imagePath: state.selectedImage.path,
                  operationId: createOperationId(),
                  sessionId: BASIC_TONE_SESSION_ID,
                }),
                { dryRun: true },
              )
            : state.lastBasicToneCommand;

        debouncedSetHistory(newAdjustments);
        return { adjustments: newAdjustments, lastBasicToneCommand };
      });
    },
    [setEditor],
  );

  const handleRotate = useCallback(
    (degrees: number) => {
      const { selectedImage, adjustments } = useEditorStore.getState();
      const increment = degrees > 0 ? 1 : 3;
      const newAspectRatio =
        adjustments.aspectRatio && adjustments.aspectRatio !== 0 ? 1 / adjustments.aspectRatio : null;
      const newOrientationSteps = ((adjustments.orientationSteps || 0) + increment) % 4;
      const newCrop =
        selectedImage && selectedImage.width && selectedImage.height
          ? calculateCenteredCrop(selectedImage.width, selectedImage.height, newOrientationSteps, newAspectRatio)
          : null;

      setAdjustments((prev) => ({
        ...prev,
        aspectRatio: newAspectRatio,
        orientationSteps: newOrientationSteps,
        rotation: 0,
        crop: newCrop,
      }));
    },
    [setAdjustments],
  );

  const handleAutoAdjustments = useCallback(async () => {
    const selectedImage = useEditorStore.getState().selectedImage;
    if (!selectedImage?.isReady) return;
    try {
      const autoAdjustments: Adjustments = await invoke(Invokes.CalculateAutoAdjustments);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...autoAdjustments,
        sectionVisibility: { ...prev.sectionVisibility, ...autoAdjustments.sectionVisibility },
      }));
    } catch (err) {
      toast.error(`Failed to apply auto adjustments: ${formatUnknownError(err)}`);
    }
  }, [setAdjustments]);

  const handleLutSelect = useCallback(
    async (path: string) => {
      const isAndroid = useSettingsStore.getState().osPlatform === 'android';
      try {
        const result: { size: number } = await invoke('load_and_parse_lut', { path });
        const name = isAndroid
          ? await invoke<string>('resolve_android_content_uri_name', { uriStr: path })
          : path.split(/[\\/]/).pop() || 'LUT';
        setAdjustments((prev: Adjustments) => ({
          ...prev,
          lutPath: path,
          lutName: name,
          lutSize: result.size,
          lutIntensity: 100,
          sectionVisibility: { ...prev.sectionVisibility, effects: true },
        }));
      } catch (err) {
        toast.error(`Failed to load LUT: ${formatUnknownError(err)}`);
      }
    },
    [setAdjustments],
  );

  const handleResetAdjustments = useCallback(
    (paths?: string[]) => {
      const { multiSelectedPaths, libraryActivePath, setLibrary } = useLibraryStore.getState();
      const { selectedImage, resetHistory } = useEditorStore.getState();
      const pathsToReset = paths || multiSelectedPaths;
      if (pathsToReset.length === 0) return;

      pathsToReset.forEach((p) => {
        globalImageCache.delete(p);
      });
      debouncedSetHistory.cancel();

      invoke(Invokes.ResetAdjustmentsForPaths, { paths: pathsToReset })
        .then(() => {
          if (libraryActivePath && pathsToReset.includes(libraryActivePath))
            setLibrary({ libraryActiveAdjustments: { ...INITIAL_ADJUSTMENTS } });
          if (selectedImage && pathsToReset.includes(selectedImage.path)) {
            const aspect =
              selectedImage.width && selectedImage.height ? selectedImage.width / selectedImage.height : null;
            const resetData = { ...INITIAL_ADJUSTMENTS, aspectRatio: aspect, aiPatches: [] };
            resetHistory(resetData);
            setEditor({ adjustments: resetData });
          }
        })
        .catch((err: unknown) => toast.error(`Failed to reset adjustments: ${formatUnknownError(err)}`));
    },
    [setEditor],
  );

  const handleCopyAdjustments = useCallback(async (pathOrEvent?: unknown) => {
    const pathOverride = typeof pathOrEvent === 'string' ? pathOrEvent : undefined;
    const { selectedImage, adjustments } = useEditorStore.getState();
    const { libraryActivePath, multiSelectedPaths } = useLibraryStore.getState();
    let sourceAdjustments: Adjustments | null = null;

    if (selectedImage) {
      sourceAdjustments = adjustments;
    } else {
      const pathToCopyFrom = pathOverride || libraryActivePath || multiSelectedPaths[0];
      if (pathToCopyFrom) {
        try {
          const meta = await invoke<MetadataResponse>(Invokes.LoadMetadata, { path: pathToCopyFrom });
          if (meta.adjustments && !meta.adjustments.is_null) {
            sourceAdjustments = normalizeLoadedAdjustments(meta.adjustments);
          } else {
            sourceAdjustments = INITIAL_ADJUSTMENTS;
          }
        } catch (err) {
          toast.error(`Failed to load metadata for copying: ${formatUnknownError(err)}`);
          return;
        }
      }
    }

    if (!sourceAdjustments) return;

    const adjustmentsToCopy: AdjustmentRecord = {};

    for (const key of COPYABLE_ADJUSTMENT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(sourceAdjustments, key)) {
        const value: unknown = sourceAdjustments[key];
        adjustmentsToCopy[key] = cloneAdjustmentValue(value);
      }
    }
    useEditorStore.getState().setEditor({ copiedAdjustments: adjustmentsToCopy });
    useProcessStore.getState().setProcess({ isCopied: true });
  }, []);

  const handlePasteAdjustments = useCallback(
    (paths?: string[]) => {
      const { copiedAdjustments, selectedImage, adjustments } = useEditorStore.getState();
      const { multiSelectedPaths } = useLibraryStore.getState();
      const { appSettings } = useSettingsStore.getState();
      const { setProcess } = useProcessStore.getState();

      if (!copiedAdjustments || !appSettings) return;

      const { mode, includedAdjustments } = appSettings.copyPasteSettings ?? {
        mode: PasteMode.Merge,
        includedAdjustments: COPYABLE_ADJUSTMENT_KEYS,
      };
      const copiedAdjustmentRecord: AdjustmentRecord = copiedAdjustments;
      const adjustmentsToApply: AdjustmentRecord = {};

      for (const key of includedAdjustments) {
        if (Object.prototype.hasOwnProperty.call(copiedAdjustmentRecord, key)) {
          const value = copiedAdjustmentRecord[key];
          if (mode === PasteMode.Merge) {
            const defaultValue: unknown = INITIAL_ADJUSTMENTS[key];
            if (JSON.stringify(value) !== JSON.stringify(defaultValue)) adjustmentsToApply[key] = value;
          } else {
            adjustmentsToApply[key] = value;
          }
        }
      }

      if (includedAdjustments.includes(LensAdjustment.LensMaker)) {
        if (!adjustmentsToApply['lensMaker']) {
          adjustmentsToApply['lensDistortionParams'] = null;
        }
      }

      if (Object.keys(adjustmentsToApply).length === 0) {
        setProcess({ isPasted: true });
        return;
      }

      const pathsToUpdate =
        paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
      if (pathsToUpdate.length === 0) return;

      pathsToUpdate.forEach((p) => {
        globalImageCache.delete(p);
      });

      if (selectedImage && pathsToUpdate.includes(selectedImage.path)) {
        setAdjustments({ ...adjustments, ...adjustmentsToApply });
      }

      invoke(Invokes.ApplyAdjustmentsToPaths, { paths: pathsToUpdate, adjustments: adjustmentsToApply })
        .then(() => {
          if (selectedImage && pathsToUpdate.includes(selectedImage.path)) {
            void invoke<MetadataResponse>(Invokes.LoadMetadata, { path: selectedImage.path })
              .then((meta) => {
                const loadedAdjustments = meta.adjustments;
                if (loadedAdjustments) {
                  setAdjustments((prev: Adjustments) => ({
                    ...prev,
                    lensMaker: loadedAdjustments.lensMaker,
                    lensModel: loadedAdjustments.lensModel,
                    lensDistortionParams: loadedAdjustments.lensDistortionParams,
                  }));
                }
              })
              .catch((err: unknown) => toast.error(`Failed to reload metadata: ${formatUnknownError(err)}`));
          }
        })
        .catch((err: unknown) => toast.error(`Failed to paste adjustments: ${formatUnknownError(err)}`));

      setProcess({ isPasted: true });
    },
    [setAdjustments],
  );

  const handleZoomChange = useCallback((zoomValue: number, fitToWindow: boolean = false) => {
    const { originalSize, baseRenderSize, adjustments } = useEditorStore.getState();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    let targetZoomPercent: number;

    const orientationSteps = adjustments.orientationSteps || 0;
    const isSwapped = orientationSteps === 1 || orientationSteps === 3;
    const effectiveOriginalWidth = isSwapped ? originalSize.height : originalSize.width;
    const effectiveOriginalHeight = isSwapped ? originalSize.width : originalSize.height;

    if (fitToWindow) {
      if (
        effectiveOriginalWidth > 0 &&
        effectiveOriginalHeight > 0 &&
        baseRenderSize.width > 0 &&
        baseRenderSize.height > 0
      ) {
        const originalAspect = effectiveOriginalWidth / effectiveOriginalHeight;
        const baseAspect = baseRenderSize.width / baseRenderSize.height;
        targetZoomPercent =
          originalAspect > baseAspect
            ? baseRenderSize.width / effectiveOriginalWidth
            : baseRenderSize.height / effectiveOriginalHeight;
      } else {
        targetZoomPercent = 1.0;
      }
    } else {
      targetZoomPercent = zoomValue / dpr;
    }

    targetZoomPercent = Math.max(0.1 / dpr, Math.min(2.0, targetZoomPercent));

    let transformZoom = 1.0;
    if (
      effectiveOriginalWidth > 0 &&
      effectiveOriginalHeight > 0 &&
      baseRenderSize.width > 0 &&
      baseRenderSize.height > 0
    ) {
      const originalAspect = effectiveOriginalWidth / effectiveOriginalHeight;
      const baseAspect = baseRenderSize.width / baseRenderSize.height;
      if (originalAspect > baseAspect) {
        transformZoom = (targetZoomPercent * effectiveOriginalWidth) / baseRenderSize.width;
      } else {
        transformZoom = (targetZoomPercent * effectiveOriginalHeight) / baseRenderSize.height;
      }
    }
    useEditorStore.getState().setEditor({ zoom: transformZoom });
  }, []);

  return {
    setAdjustments,
    handleRotate,
    handleAutoAdjustments,
    handleLutSelect,
    handleResetAdjustments,
    handleCopyAdjustments,
    handlePasteAdjustments,
    handleZoomChange,
  };
}
