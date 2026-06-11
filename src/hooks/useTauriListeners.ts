import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Status } from '../components/ui/ExportImportProperties';
import { ChannelConfig } from '../components/adjustments/Curves';
import { ImageFile, WaveformData } from '../components/ui/AppProperties';
import { useProcessStore } from '../store/useProcessStore';
import { useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { useLibraryStore } from '../store/useLibraryStore';
import {
  parseBase64Payload,
  parseCountPayload,
  parseCullingProgressPayload,
  parseCullingSuggestionsPayload,
  parseDenoiseCompletePayload,
  parseImportProgressPayload,
  parseImportStartPayload,
  parseProgressPayload,
  parseRenderPathPayload,
  parseStringPayload,
  parseThumbnailGeneratedPayload,
} from '../schemas/tauriEventSchemas';

interface TauriListenerProps {
  refreshAllFolderTrees: () => void;
  handleSelectSubfolder: (
    path: string,
    isNewRoot?: boolean,
    preloadedImages?: Array<ImageFile>,
    expandParents?: boolean,
  ) => void;
  refreshImageList: () => void;
  markGenerated: (path: string) => void;
}

interface ImageAnalyticsPayload<TData> {
  data: TData;
  path: string;
}

export function useTauriListeners({
  refreshAllFolderTrees,
  handleSelectSubfolder,
  refreshImageList,
  markGenerated,
}: TauriListenerProps) {
  const refs = useRef({ refreshAllFolderTrees, handleSelectSubfolder, refreshImageList, markGenerated });

  useEffect(() => {
    refs.current = { refreshAllFolderTrees, handleSelectSubfolder, refreshImageList, markGenerated };
  });

  const thumbnailBuffer = useRef<Record<string, string>>({});
  const ratingBuffer = useRef<Record<string, number>>({});
  const editStatusBuffer = useRef<Record<string, boolean>>({});
  const flushHandle = useRef<number | null>(null);

  useEffect(() => {
    let isEffectActive = true;

    const flushThumbnailBatch = () => {
      flushHandle.current = null;
      if (!isEffectActive) return;

      const pendingThumbs = thumbnailBuffer.current;
      const pendingRatings = ratingBuffer.current;
      const pendingEdits = editStatusBuffer.current;

      thumbnailBuffer.current = {};
      ratingBuffer.current = {};
      editStatusBuffer.current = {};

      if (Object.keys(pendingThumbs).length > 0) {
        useProcessStore.getState().setProcess((state) => ({
          thumbnails: { ...state.thumbnails, ...pendingThumbs },
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
      listen<unknown>('preview-update-uncropped', (event) => {
        if (isEffectActive)
          useEditorStore.getState().setEditor({ uncroppedAdjustedPreviewUrl: parseStringPayload(event.payload) });
      }),
      listen<ImageAnalyticsPayload<ChannelConfig>>('histogram-update', (event) => {
        if (isEffectActive && event.payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor({ histogram: event.payload.data });
        }
      }),
      listen<unknown>('open-with-file', (event) => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ initialFileToOpen: parseStringPayload(event.payload) });
      }),
      listen<ImageAnalyticsPayload<WaveformData>>('waveform-update', (event) => {
        if (isEffectActive && event.payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor({ waveform: event.payload.data });
        }
      }),
      listen<unknown>('thumbnail-progress', (event) => {
        const payload = parseProgressPayload(event.payload);
        if (isEffectActive)
          useProcessStore
            .getState()
            .setProcess({ thumbnailProgress: { current: payload.current, total: payload.total } });
      }),
      listen('thumbnail-generation-complete', () => {
        if (isEffectActive) useProcessStore.getState().setProcess({ thumbnailProgress: { current: 0, total: 0 } });
      }),
      listen<unknown>('thumbnail-generated', (event) => {
        if (!isEffectActive) return;
        const { path, data, rating, is_edited } = parseThumbnailGeneratedPayload(event.payload);

        if (data) {
          thumbnailBuffer.current[path] = data;
          refs.current.markGenerated(path);
        }
        if (rating !== undefined) {
          ratingBuffer.current[path] = rating;
        }
        if (is_edited !== undefined) {
          editStatusBuffer.current[path] = is_edited;
        }
        if (data || rating !== undefined || is_edited !== undefined) {
          scheduleFlush();
        }
      }),
      listen<unknown>('ai-model-download-start', (event) => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ aiModelDownloadStatus: parseStringPayload(event.payload) });
      }),
      listen('ai-model-download-finish', () => {
        if (isEffectActive) useProcessStore.getState().setProcess({ aiModelDownloadStatus: null });
      }),
      listen('indexing-started', () => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ isIndexing: true, indexingProgress: { current: 0, total: 0 } });
      }),
      listen<unknown>('indexing-progress', (event) => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ indexingProgress: parseProgressPayload(event.payload) });
      }),
      listen('indexing-finished', () => {
        if (isEffectActive) {
          useProcessStore.getState().setProcess({ isIndexing: false, indexingProgress: { current: 0, total: 0 } });
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath) {
            refs.current.refreshImageList();
          }
        }
      }),
      listen<unknown>('batch-export-progress', (event) => {
        if (isEffectActive)
          useProcessStore.getState().setExportState({ progress: parseProgressPayload(event.payload) });
      }),
      listen('export-complete', () => {
        if (isEffectActive) useProcessStore.getState().setExportState({ status: Status.Success });
      }),
      listen<unknown>('export-error', (event) => {
        if (isEffectActive)
          useProcessStore.getState().setExportState({
            status: Status.Error,
            errorMessage: parseStringPayload(event.payload),
          });
      }),
      listen('export-cancelled', () => {
        if (isEffectActive) useProcessStore.getState().setExportState({ status: Status.Cancelled });
      }),
      listen<unknown>('import-start', (event) => {
        const payload = parseImportStartPayload(event.payload);
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            errorMessage: '',
            path: '',
            progress: { current: 0, total: payload.total },
            status: Status.Importing,
          });
      }),
      listen<unknown>('import-progress', (event) => {
        const payload = parseImportProgressPayload(event.payload);
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            path: payload.path,
            progress: { current: payload.current, total: payload.total },
          });
      }),
      listen('import-complete', () => {
        if (isEffectActive) {
          useProcessStore.getState().setImportState({ status: Status.Success });
          refs.current.refreshAllFolderTrees();
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath) {
            refs.current.handleSelectSubfolder(currentPath, false);
          }
        }
      }),
      listen<unknown>('import-error', (event) => {
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            status: Status.Error,
            errorMessage: parseStringPayload(event.payload),
          });
      }),
      listen<unknown>('denoise-progress', (event) => {
        const payload = parseStringPayload(event.payload);
        if (isEffectActive)
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: { ...state.denoiseModalState, progressMessage: payload },
          }));
      }),
      listen<unknown>('denoise-complete', (event) => {
        if (isEffectActive) {
          const payload = parseDenoiseCompletePayload(event.payload);
          const isObject = typeof payload === 'object' && payload !== null;
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: {
              ...state.denoiseModalState,
              isProcessing: false,
              previewBase64: isObject ? payload.denoised : payload,
              originalBase64: isObject ? (payload.original ?? null) : null,
              progressMessage: null,
            },
          }));
        }
      }),
      listen<unknown>('denoise-error', (event) => {
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
      listen<unknown>('wgpu-frame-ready', (event) => {
        const payload = parseRenderPathPayload(event.payload);
        if (isEffectActive && payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor({ hasRenderedFirstFrame: true });
        }
      }),
      listen<unknown>('panorama-progress', (event) => {
        const payload = parseStringPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => {
            if (state.panoramaModalState.finalImageBase64 || state.panoramaModalState.error) return state;
            return { panoramaModalState: { ...state.panoramaModalState, progressMessage: payload } };
          });
        }
      }),
      listen<unknown>('panorama-complete', (event) => {
        const payload = parseBase64Payload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            panoramaModalState: {
              ...state.panoramaModalState,
              error: null,
              finalImageBase64: payload.base64,
              isProcessing: false,
              progressMessage: null,
            },
          }));
        }
      }),
      listen<unknown>('panorama-error', (event) => {
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
      listen<unknown>('hdr-progress', (event) => {
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
      listen<unknown>('hdr-complete', (event) => {
        const payload = parseBase64Payload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: null,
              finalImageBase64: payload.base64,
              isProcessing: false,
              progressMessage: 'Hdr Ready',
            },
          }));
        }
      }),
      listen<unknown>('hdr-error', (event) => {
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
      listen<unknown>('culling-start', (event) => {
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
      listen<unknown>('culling-progress', (event) => {
        const payload = parseCullingProgressPayload(event.payload);
        if (isEffectActive) {
          useUIStore
            .getState()
            .setUI((state) => ({ cullingModalState: { ...state.cullingModalState, progress: payload } }));
        }
      }),
      listen<unknown>('culling-complete', (event) => {
        const payload = parseCullingSuggestionsPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: { ...state.cullingModalState, progress: null, suggestions: payload },
          }));
        }
      }),
      listen<unknown>('culling-error', (event) => {
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
      ratingBuffer.current = {};
      listeners.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);
}
