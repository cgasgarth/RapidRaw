import { create } from 'zustand';
import type { Progress } from '../components/ui/AppProperties';
import { type ExportState, type ImportState, Status } from '../components/ui/ExportImportProperties';
import { thumbnailResourceCache } from '../utils/thumbnailResources';

export interface ThumbnailSmartPreviewState {
  colorProfile: string;
  height: number;
  source: string;
  sourceAvailable: boolean;
  sourceRevision: string;
  stale: boolean;
  width: number;
}

interface ProcessState {
  exportState: ExportState;
  importState: ImportState;
  isIndexing: boolean;
  indexingProgress: Progress;
  thumbnails: Record<string, string>;
  thumbnailSmartPreviews: Record<string, ThumbnailSmartPreviewState>;
  thumbnailProgress: Progress;
  aiModelDownloadStatus: string | null;
  copiedFilePaths: Array<string>;
  isCopied: boolean;
  isPasted: boolean;
  initialFileToOpen: string | null;

  setProcess: (state: Partial<ProcessState> | ((state: ProcessState) => Partial<ProcessState>)) => void;
  setExportState: (updater: Partial<ExportState> | ((state: ExportState) => Partial<ExportState>)) => void;
  setImportState: (updater: Partial<ImportState> | ((state: ImportState) => Partial<ImportState>)) => void;
  invalidateThumbnails: (paths: ReadonlyArray<string>) => void;
}

let importTimeout: ReturnType<typeof setTimeout>;
let copyTimeout: ReturnType<typeof setTimeout>;
let pasteTimeout: ReturnType<typeof setTimeout>;

const omitPaths = <Value>(record: Record<string, Value>, paths: ReadonlySet<string>): Record<string, Value> =>
  Object.fromEntries(Object.entries(record).filter(([path]) => !paths.has(path)));

export const useProcessStore = create<ProcessState>((set, get) => ({
  exportState: { errorMessage: '', progress: { current: 0, total: 0 }, status: Status.Idle },
  importState: { errorMessage: '', path: '', progress: { current: 0, total: 0 }, status: Status.Idle },
  isIndexing: false,
  indexingProgress: { current: 0, total: 0 },
  thumbnails: {},
  thumbnailSmartPreviews: {},
  thumbnailProgress: { current: 0, total: 0 },
  aiModelDownloadStatus: null,
  copiedFilePaths: [],
  isCopied: false,
  isPasted: false,
  initialFileToOpen: null,

  setProcess: (updater) => {
    set((prev) => {
      const nextState = typeof updater === 'function' ? updater(prev) : updater;
      return { ...prev, ...nextState };
    });

    const state = get();
    if (state.isCopied) {
      clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        set({ isCopied: false });
      }, 1000);
    }
    if (state.isPasted) {
      clearTimeout(pasteTimeout);
      pasteTimeout = setTimeout(() => {
        set({ isPasted: false });
      }, 1000);
    }
  },

  invalidateThumbnails: (paths) => {
    const pathSet = new Set(paths);
    if (pathSet.size === 0) return;
    for (const path of pathSet) thumbnailResourceCache.delete(path);

    set((prev) => {
      return {
        thumbnailSmartPreviews: omitPaths(prev.thumbnailSmartPreviews, pathSet),
        thumbnails: omitPaths(prev.thumbnails, pathSet),
      };
    });
  },

  setExportState: (updater) => {
    set((prev) => ({
      exportState: (() => {
        const patch = typeof updater === 'function' ? updater(prev.exportState) : updater;
        const nextStatus = patch.status ?? prev.exportState.status;
        const isStartingNewExport = nextStatus === Status.Exporting && prev.exportState.status !== Status.Exporting;
        const isTerminalWithoutReceipt =
          nextStatus === Status.Error || (nextStatus === Status.Cancelled && patch.lastReceipt === undefined);
        const isResetting = nextStatus === Status.Idle;

        return {
          ...prev.exportState,
          ...(isStartingNewExport || isTerminalWithoutReceipt || isResetting ? { lastReceipt: undefined } : {}),
          ...(isStartingNewExport || isResetting ? { errorMessage: '' } : {}),
          ...(isStartingNewExport || isResetting ? { progress: { current: 0, total: 0 } } : {}),
          ...patch,
        };
      })(),
    }));
  },

  setImportState: (updater) => {
    set((prev) => ({
      importState: { ...prev.importState, ...(typeof updater === 'function' ? updater(prev.importState) : updater) },
    }));

    const status = get().importState.status;

    clearTimeout(importTimeout);

    if ([Status.Success, Status.Error, Status.Cancelled].includes(status)) {
      importTimeout = setTimeout(() => {
        set((prev) => ({
          importState: {
            ...prev.importState,
            status: Status.Idle,
            errorMessage: '',
            progress: { current: 0, total: 0 },
          },
        }));
      }, 5000);
    }
  },
}));
