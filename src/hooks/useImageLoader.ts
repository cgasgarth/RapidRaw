import { invoke } from '@tauri-apps/api/core';
import { useEffect, type RefObject } from 'react';
import { toast } from 'react-toastify';

import { isNullAdjustmentSnapshot, parseLoadedMetadata, parseLoadImageResult } from '../schemas/imageLoaderSchemas';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { Invokes } from '../tauri/commands';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../utils/adjustments';
import { formatUnknownError } from '../utils/errorFormatting';
import { consumePendingNegativeConversionDustHealLayers } from '../utils/negativeLabEditorHandoff';

import type { ImageCacheEntry } from '../utils/ImageLRUCache';

export function useImageLoader(cachedEditStateRef: RefObject<ImageCacheEntry | null>) {
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const selectedImagePath = selectedImage?.path;
  const selectedImageIsReady = selectedImage?.isReady;
  const adjustments = useEditorStore((s) => s.adjustments);
  const histogram = useEditorStore((s) => s.histogram);
  const waveform = useEditorStore((s) => s.waveform);
  const finalPreviewUrl = useEditorStore((s) => s.finalPreviewUrl);
  const uncroppedAdjustedPreviewUrl = useEditorStore((s) => s.uncroppedAdjustedPreviewUrl);
  const originalSize = useEditorStore((s) => s.originalSize);
  const previewSize = useEditorStore((s) => s.previewSize);
  const hasRenderedFirstFrame = useEditorStore((s) => s.hasRenderedFirstFrame);

  const setEditor = useEditorStore((s) => s.setEditor);
  const resetHistory = useEditorStore((s) => s.resetHistory);
  const setLibrary = useLibraryStore((s) => s.setLibrary);
  const appSettings = useSettingsStore((s) => s.appSettings);

  const isWgpuActive = appSettings?.useWgpuRenderer !== false && selectedImage?.isReady && hasRenderedFirstFrame;

  useEffect(() => {
    if (selectedImagePath && !selectedImageIsReady) {
      let isEffectActive = true;

      const loadMetadataEarly = async () => {
        try {
          useEditorStore.getState().patchesSentToBackend.clear();
          await invoke(Invokes.ClearSessionCaches).catch((e: unknown) => {
            console.warn('Cache clear failed:', e);
          });

          const metadata = parseLoadedMetadata(
            await invoke<unknown>(Invokes.LoadMetadata, { path: selectedImagePath }),
          );
          if (!isEffectActive) return;

          let initialAdjusts;
          if (metadata.adjustments && !isNullAdjustmentSnapshot(metadata.adjustments)) {
            initialAdjusts = normalizeLoadedAdjustments(metadata.adjustments);
          } else {
            initialAdjusts = { ...INITIAL_ADJUSTMENTS };
          }

          setEditor({ adjustments: initialAdjusts });
          resetHistory(initialAdjusts);
        } catch (err) {
          console.error('Failed to load metadata early:', err);
        }
      };

      const loadFullImageData = async () => {
        try {
          const loadImageResult = parseLoadImageResult(
            await invoke<unknown>(Invokes.LoadImage, { path: selectedImagePath }),
          );
          if (!isEffectActive) return;

          const { width, height } = loadImageResult;
          setEditor({ originalSize: { width, height } });

          if (appSettings?.editorPreviewResolution) {
            const maxSize = appSettings.editorPreviewResolution;
            const aspectRatio = width / height;

            if (width > height) {
              const pWidth = Math.min(width, maxSize);
              const pHeight = Math.round(pWidth / aspectRatio);
              setEditor({ previewSize: { width: pWidth, height: pHeight } });
            } else {
              const pHeight = Math.min(height, maxSize);
              const pWidth = Math.round(pHeight * aspectRatio);
              setEditor({ previewSize: { width: pWidth, height: pHeight } });
            }
          } else {
            setEditor({ previewSize: { width: 0, height: 0 } });
          }

          setEditor((state) => {
            if (state.selectedImage && state.selectedImage.path === selectedImagePath) {
              return {
                selectedImage: {
                  ...state.selectedImage,
                  exif: loadImageResult.exif ?? null,
                  height: loadImageResult.height,
                  isOfflineSmartPreview: loadImageResult.is_offline_smart_preview === true,
                  isRaw: loadImageResult.is_raw,
                  isReady: true,
                  metadata: loadImageResult.metadata,
                  originalUrl: null,
                  rawDevelopmentReport: loadImageResult.raw_development_report ?? null,
                  width: loadImageResult.width,
                },
              };
            }
            return state;
          });

          setEditor((state) => {
            if (!state.adjustments.aspectRatio && !state.adjustments.crop) {
              return {
                adjustments: { ...state.adjustments, aspectRatio: loadImageResult.width / loadImageResult.height },
              };
            }
            return state;
          });
          consumePendingNegativeConversionDustHealLayers(selectedImagePath);
        } catch (err) {
          if (isEffectActive) {
            console.error('Failed to load image:', err);
            toast.error(`Failed to load image: ${formatUnknownError(err)}`);
            setEditor({ selectedImage: null });
          }
        } finally {
          if (isEffectActive) {
            setLibrary({ isViewLoading: false });
          }
        }
      };

      const loadAll = async () => {
        await loadMetadataEarly();
        if (isEffectActive) {
          await loadFullImageData();
        }
      };

      void loadAll();

      return () => {
        isEffectActive = false;
      };
    }
    return undefined;
  }, [
    selectedImagePath,
    selectedImageIsReady,
    appSettings?.editorPreviewResolution,
    resetHistory,
    setEditor,
    setLibrary,
  ]);

  useEffect(() => {
    if (selectedImage?.path && selectedImage.isReady && (finalPreviewUrl || isWgpuActive)) {
      cachedEditStateRef.current = {
        adjustments,
        histogram,
        waveform,
        finalPreviewUrl,
        uncroppedPreviewUrl: uncroppedAdjustedPreviewUrl,
        selectedImage,
        originalSize,
        previewSize,
      };
    } else {
      cachedEditStateRef.current = null;
    }
  }, [
    selectedImage,
    adjustments,
    histogram,
    waveform,
    finalPreviewUrl,
    uncroppedAdjustedPreviewUrl,
    originalSize,
    previewSize,
    isWgpuActive,
    cachedEditStateRef,
  ]);
}
