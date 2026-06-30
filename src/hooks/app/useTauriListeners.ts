import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import type { ChannelConfig } from '../../components/adjustments/Curves';
import type { WaveformData } from '../../components/ui/AppProperties';
import { Status } from '../../components/ui/ExportImportProperties';
import {
  gamutWarningOverlayPayloadSchema,
  parseBase64Payload,
  parseCountPayload,
  parseCullingProgressPayload,
  parseCullingSuggestionsPayload,
  parseDenoiseCompletePayload,
  parseExportReceiptPayload,
  parseImportProgressPayload,
  parseImportStartPayload,
  parsePanoramaCompletePayload,
  parseProgressPayload,
  parseRenderPathPayload,
  parseStringPayload,
  parseThumbnailGeneratedPayload,
} from '../../schemas/tauriEventSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import type { ThumbnailSmartPreviewState } from '../../store/useProcessStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useUIStore } from '../../store/useUIStore';
import {
  buildHdrApplyCommandState,
  buildPanoramaApplyCommandState,
} from '../../utils/computational-merge/computationalMergeModalState';
import {
  AI_MODEL_DOWNLOAD_FINISH_EVENT,
  AI_MODEL_DOWNLOAD_START_EVENT,
  BATCH_EXPORT_PROGRESS_EVENT,
  CULLING_COMPLETE_EVENT,
  CULLING_ERROR_EVENT,
  CULLING_PROGRESS_EVENT,
  CULLING_START_EVENT,
  DENOISE_COMPLETE_EVENT,
  DENOISE_ERROR_EVENT,
  DENOISE_PROGRESS_EVENT,
  EXPORT_CANCELLED_EVENT,
  EXPORT_COMPLETE_EVENT,
  EXPORT_ERROR_EVENT,
  GAMUT_WARNING_UPDATE_EVENT,
  HDR_COMPLETE_EVENT,
  HDR_ERROR_EVENT,
  HDR_PROGRESS_EVENT,
  HISTOGRAM_UPDATE_EVENT,
  IMPORT_COMPLETE_EVENT,
  IMPORT_ERROR_EVENT,
  IMPORT_PROGRESS_EVENT,
  IMPORT_START_EVENT,
  INDEXING_FINISHED_EVENT,
  INDEXING_PROGRESS_EVENT,
  INDEXING_STARTED_EVENT,
  OPEN_WITH_FILE_EVENT,
  PANORAMA_COMPLETE_EVENT,
  PANORAMA_ERROR_EVENT,
  PANORAMA_PROGRESS_EVENT,
  PREVIEW_UPDATE_UNCROPPED_EVENT,
  THUMBNAIL_GENERATED_EVENT,
  THUMBNAIL_GENERATION_COMPLETE_EVENT,
  THUMBNAIL_PROGRESS_EVENT,
  WAVEFORM_UPDATE_EVENT,
  WGPU_FRAME_READY_EVENT,
} from '../../utils/tauriEventNames';

interface TauriListenerProps {
  refreshAllFolderTrees: () => void;
  refreshImageList: () => void;
  markGenerated: (path: string) => void;
}

interface ImageAnalyticsPayload<TData> {
  data: TData;
  path: string;
}

const PREVIEW_SCOPE_DISPLAY_TRANSFORM_LABEL = 'Display preview transform';
const PREVIEW_SCOPE_SOURCE_LABEL = 'Edited preview';
const PREVIEW_SCOPE_WORKING_TRANSFORM_LABEL = 'Working RGB';
const PREVIEW_SCOPE_EXPORT_SOURCE_LABEL = 'Export preview';

const buildPreviewScopeStatus = ({
  histogramReady,
  path,
  waveformReady,
}: {
  histogramReady: boolean;
  path: string;
  waveformReady: boolean;
}) => {
  const editor = useEditorStore.getState();
  const transform = editor.exportSoftProofTransform;
  const isExportPreview = editor.isExportSoftProofEnabled && transform !== null;

  return {
    displayTransformLabel: transform?.colorManagedTransform ?? PREVIEW_SCOPE_DISPLAY_TRANSFORM_LABEL,
    exportProfileLabel: isExportPreview ? transform.effectiveColorProfile : null,
    exportRenderingIntentLabel: isExportPreview ? transform.effectiveRenderingIntent : null,
    histogramReady,
    path,
    renderBasis: isExportPreview ? ('export_preview' as const) : ('editor_preview' as const),
    softProofTransformApplied: transform?.transformApplied ?? false,
    sourceLabel: isExportPreview ? PREVIEW_SCOPE_EXPORT_SOURCE_LABEL : PREVIEW_SCOPE_SOURCE_LABEL,
    updatedAt: new Date().toISOString(),
    waveformReady,
    warningCodes: isExportPreview
      ? [
          transform.transformApplied ? 'export_profile_transform_applied' : 'export_profile_transform_missing',
          'render_target_matches_export_recipe',
        ]
      : [],
    workingTransformLabel: PREVIEW_SCOPE_WORKING_TRANSFORM_LABEL,
  };
};

export function useTauriListeners({ refreshAllFolderTrees, refreshImageList, markGenerated }: TauriListenerProps) {
  const refs = useRef({ refreshAllFolderTrees, refreshImageList, markGenerated });

  useEffect(() => {
    refs.current = { refreshAllFolderTrees, refreshImageList, markGenerated };
  });

  const thumbnailBuffer = useRef<Record<string, string>>({});
  const smartPreviewBuffer = useRef<Record<string, ThumbnailSmartPreviewState>>({});
  const ratingBuffer = useRef<Record<string, number>>({});
  const editStatusBuffer = useRef<Record<string, boolean>>({});
  const flushHandle = useRef<number | null>(null);

  useEffect(() => {
    let isEffectActive = true;

    const flushThumbnailBatch = () => {
      flushHandle.current = null;
      if (!isEffectActive) return;

      const pendingThumbs = thumbnailBuffer.current;
      const pendingSmartPreviews = smartPreviewBuffer.current;
      const pendingRatings = ratingBuffer.current;
      const pendingEdits = editStatusBuffer.current;

      thumbnailBuffer.current = {};
      smartPreviewBuffer.current = {};
      ratingBuffer.current = {};
      editStatusBuffer.current = {};

      if (Object.keys(pendingThumbs).length > 0) {
        useProcessStore.getState().setProcess((state) => ({
          thumbnails: { ...state.thumbnails, ...pendingThumbs },
        }));

        const selectedImage = useEditorStore.getState().selectedImage;
        if (selectedImage?.path && pendingThumbs[selectedImage.path]) {
          useEditorStore.getState().setEditor((state) =>
            state.selectedImage?.path === selectedImage.path
              ? {
                  selectedImage: {
                    ...state.selectedImage,
                    thumbnailUrl: pendingThumbs[selectedImage.path] ?? state.selectedImage.thumbnailUrl,
                  },
                }
              : state,
          );
        }
      }

      if (Object.keys(pendingSmartPreviews).length > 0) {
        useProcessStore.getState().setProcess((state) => ({
          thumbnailSmartPreviews: { ...state.thumbnailSmartPreviews, ...pendingSmartPreviews },
        }));
      }

      if (Object.keys(pendingRatings).length > 0 || Object.keys(pendingEdits).length > 0) {
        useLibraryStore.getState().setLibrary((state) => ({
          imageRatings: { ...state.imageRatings, ...pendingRatings },
          imageList:
            Object.keys(pendingEdits).length > 0
              ? state.imageList.map((img) =>
                  pendingEdits[img.path] !== undefined ? { ...img, is_edited: pendingEdits[img.path] ?? false } : img,
                )
              : state.imageList,
        }));
      }
    };

    const scheduleFlush = () => {
      if (flushHandle.current !== null) return;
      flushHandle.current = requestAnimationFrame(flushThumbnailBatch);
    };

    const listeners = [
      listen<unknown>(PREVIEW_UPDATE_UNCROPPED_EVENT, (event) => {
        if (isEffectActive)
          useEditorStore.getState().setEditor({ uncroppedAdjustedPreviewUrl: parseStringPayload(event.payload) });
      }),
      listen<ImageAnalyticsPayload<ChannelConfig>>(HISTOGRAM_UPDATE_EVENT, (event) => {
        if (isEffectActive && event.payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor((state) => ({
            histogram: event.payload.data,
            previewScopeStatus: buildPreviewScopeStatus({
              histogramReady: true,
              path: event.payload.path,
              waveformReady:
                state.previewScopeStatus?.path === event.payload.path ? state.previewScopeStatus.waveformReady : false,
            }),
          }));
        }
      }),
      listen<ImageAnalyticsPayload<unknown>>(GAMUT_WARNING_UPDATE_EVENT, (event) => {
        const editor = useEditorStore.getState();
        if (isEffectActive && event.payload.path === editor.selectedImage?.path) {
          const parsed = gamutWarningOverlayPayloadSchema.safeParse(event.payload.data);
          useEditorStore.getState().setEditor({ gamutWarningOverlay: parsed.success ? parsed.data : null });
        }
      }),
      listen<unknown>(OPEN_WITH_FILE_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ initialFileToOpen: parseStringPayload(event.payload) });
      }),
      listen<ImageAnalyticsPayload<WaveformData>>(WAVEFORM_UPDATE_EVENT, (event) => {
        if (isEffectActive && event.payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor((state) => ({
            previewScopeStatus: buildPreviewScopeStatus({
              histogramReady:
                state.previewScopeStatus?.path === event.payload.path ? state.previewScopeStatus.histogramReady : false,
              path: event.payload.path,
              waveformReady: true,
            }),
            waveform: event.payload.data,
          }));
        }
      }),
      listen<unknown>(THUMBNAIL_PROGRESS_EVENT, (event) => {
        const payload = parseProgressPayload(event.payload);
        if (isEffectActive)
          useProcessStore
            .getState()
            .setProcess({ thumbnailProgress: { current: payload.current, total: payload.total } });
      }),
      listen(THUMBNAIL_GENERATION_COMPLETE_EVENT, () => {
        if (isEffectActive) useProcessStore.getState().setProcess({ thumbnailProgress: { current: 0, total: 0 } });
      }),
      listen<unknown>(THUMBNAIL_GENERATED_EVENT, (event) => {
        if (!isEffectActive) return;
        const { path, data, rating, is_edited, smartPreview } = parseThumbnailGeneratedPayload(event.payload);

        if (data) {
          thumbnailBuffer.current[path] = data;
          refs.current.markGenerated(path);
        }
        if (smartPreview) {
          smartPreviewBuffer.current[path] = smartPreview;
        }
        if (rating !== undefined) {
          ratingBuffer.current[path] = rating;
        }
        if (is_edited !== undefined) {
          editStatusBuffer.current[path] = is_edited;
        }
        if (data || rating !== undefined || is_edited !== undefined || smartPreview) {
          scheduleFlush();
        }
      }),
      listen<unknown>(AI_MODEL_DOWNLOAD_START_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ aiModelDownloadStatus: parseStringPayload(event.payload) });
      }),
      listen(AI_MODEL_DOWNLOAD_FINISH_EVENT, () => {
        if (isEffectActive) useProcessStore.getState().setProcess({ aiModelDownloadStatus: null });
      }),
      listen(INDEXING_STARTED_EVENT, () => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ isIndexing: true, indexingProgress: { current: 0, total: 0 } });
      }),
      listen<unknown>(INDEXING_PROGRESS_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ indexingProgress: parseProgressPayload(event.payload) });
      }),
      listen(INDEXING_FINISHED_EVENT, () => {
        if (isEffectActive) {
          useProcessStore.getState().setProcess({ isIndexing: false, indexingProgress: { current: 0, total: 0 } });
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath) {
            refs.current.refreshImageList();
          }
        }
      }),
      listen<unknown>(BATCH_EXPORT_PROGRESS_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setExportState({ progress: parseProgressPayload(event.payload) });
      }),
      listen<unknown>(EXPORT_COMPLETE_EVENT, (event) => {
        if (isEffectActive) {
          useProcessStore.getState().setExportState({
            lastReceipt: parseExportReceiptPayload(event.payload),
            status: Status.Success,
          });
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath && !currentPath.startsWith('Album: ')) {
            refs.current.refreshImageList();
            refs.current.refreshAllFolderTrees();
          }
        }
      }),
      listen<unknown>(EXPORT_ERROR_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setExportState({
            status: Status.Error,
            errorMessage: parseStringPayload(event.payload),
          });
      }),
      listen(EXPORT_CANCELLED_EVENT, () => {
        if (isEffectActive) useProcessStore.getState().setExportState({ status: Status.Cancelled });
      }),
      listen<unknown>(IMPORT_START_EVENT, (event) => {
        const payload = parseImportStartPayload(event.payload);
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            errorMessage: '',
            path: '',
            progress: { current: 0, total: payload.total },
            status: Status.Importing,
          });
      }),
      listen<unknown>(IMPORT_PROGRESS_EVENT, (event) => {
        const payload = parseImportProgressPayload(event.payload);
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            path: payload.path,
            progress: { current: payload.current, total: payload.total },
          });
      }),
      listen(IMPORT_COMPLETE_EVENT, () => {
        if (isEffectActive) {
          useProcessStore.getState().setImportState({ status: Status.Success });
          refs.current.refreshAllFolderTrees();
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath) {
            refs.current.refreshImageList();
          }
        }
      }),
      listen<unknown>(IMPORT_ERROR_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            status: Status.Error,
            errorMessage: parseStringPayload(event.payload),
          });
      }),
      listen<unknown>(DENOISE_PROGRESS_EVENT, (event) => {
        const payload = parseStringPayload(event.payload);
        if (isEffectActive)
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: { ...state.denoiseModalState, progressMessage: payload },
          }));
      }),
      listen<unknown>(DENOISE_COMPLETE_EVENT, (event) => {
        if (isEffectActive) {
          const payload = parseDenoiseCompletePayload(event.payload);
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: {
              ...state.denoiseModalState,
              isProcessing: false,
              previewBase64: typeof payload === 'string' ? payload : payload.denoised,
              originalBase64: typeof payload === 'string' ? null : (payload.original ?? null),
              progressMessage: null,
            },
          }));
        }
      }),
      listen<unknown>(DENOISE_ERROR_EVENT, (event) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: {
              ...state.denoiseModalState,
              isProcessing: false,
              error: parseStringPayload(event.payload),
              progressMessage: null,
            },
          }));
        }
      }),
      listen<unknown>(WGPU_FRAME_READY_EVENT, (event) => {
        const payload = parseRenderPathPayload(event.payload);
        if (isEffectActive && payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor({ hasRenderedFirstFrame: true });
        }
      }),
      listen<unknown>(PANORAMA_PROGRESS_EVENT, (event) => {
        const payload = parseStringPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => {
            if (state.panoramaModalState.finalImageBase64 || state.panoramaModalState.error) return state;
            return { panoramaModalState: { ...state.panoramaModalState, progressMessage: payload } };
          });
        }
      }),
      listen<unknown>(PANORAMA_COMPLETE_EVENT, (event) => {
        const payload = parsePanoramaCompletePayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            panoramaModalState: {
              ...state.panoramaModalState,
              error: null,
              finalImageBase64: payload.base64,
              isProcessing: false,
              lastApplyCommand: buildPanoramaApplyCommandState({
                base64Length: payload.base64.length,
                sourceCount: state.panoramaModalState.stitchingSourcePaths.length,
              }),
              progressMessage: null,
              renderedReview: payload.review,
            },
          }));
        }
      }),
      listen<unknown>(PANORAMA_ERROR_EVENT, (event) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            panoramaModalState: {
              ...state.panoramaModalState,
              error: parseStringPayload(event.payload),
              finalImageBase64: null,
              isProcessing: false,
              progressMessage: null,
            },
          }));
        }
      }),
      listen<unknown>(HDR_PROGRESS_EVENT, (event) => {
        const payload = parseStringPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: null,
              finalImageBase64: null,
              isOpen: true,
              progressMessage: payload,
            },
          }));
        }
      }),
      listen<unknown>(HDR_COMPLETE_EVENT, (event) => {
        const payload = parseBase64Payload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: null,
              finalImageBase64: payload.base64,
              isProcessing: false,
              lastApplyCommand: buildHdrApplyCommandState({
                base64Length: payload.base64.length,
                sourceCount: state.hdrModalState.stitchingSourcePaths.length,
              }),
              progressMessage: 'Hdr Ready',
            },
          }));
        }
      }),
      listen<unknown>(HDR_ERROR_EVENT, (event) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: parseStringPayload(event.payload),
              finalImageBase64: null,
              isProcessing: false,
              progressMessage: 'An error occurred.',
            },
          }));
        }
      }),
      listen<unknown>(CULLING_START_EVENT, (event) => {
        const total = parseCountPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: {
              ...state.cullingModalState,
              isOpen: true,
              progress: { current: 0, total, stage: 'Initializing...' },
              suggestions: null,
              error: null,
            },
          }));
        }
      }),
      listen<unknown>(CULLING_PROGRESS_EVENT, (event) => {
        const payload = parseCullingProgressPayload(event.payload);
        if (isEffectActive) {
          useUIStore
            .getState()
            .setUI((state) => ({ cullingModalState: { ...state.cullingModalState, progress: payload } }));
        }
      }),
      listen<unknown>(CULLING_COMPLETE_EVENT, (event) => {
        const payload = parseCullingSuggestionsPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: { ...state.cullingModalState, progress: null, suggestions: payload },
          }));
        }
      }),
      listen<unknown>(CULLING_ERROR_EVENT, (event) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: { ...state.cullingModalState, progress: null, error: parseStringPayload(event.payload) },
          }));
        }
      }),
    ];

    return () => {
      isEffectActive = false;
      if (flushHandle.current !== null) {
        cancelAnimationFrame(flushHandle.current);
        flushHandle.current = null;
      }
      thumbnailBuffer.current = {};
      smartPreviewBuffer.current = {};
      ratingBuffer.current = {};
      listeners.forEach((p) => {
        void p.then((unlisten) => {
          unlisten();
        });
      });
    };
  }, []);
}
