import { type AppSettings, LibraryViewMode, Theme, ThumbnailSize } from '../components/ui/AppProperties.tsx';
import { Invokes } from '../tauri/commands.ts';

type BrowserTauriInvoke = (command: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
type BrowserTauriEventCallback = (event: unknown) => void;

interface BrowserTauriInternals {
  convertFileSrc: (filePath: string, protocol?: string) => string;
  invoke: BrowserTauriInvoke;
  transformCallback: (callback: unknown, once?: boolean) => number;
  unregisterCallback: (id: number) => void;
}

interface BrowserTauriInvokeCall {
  args?: Record<string, unknown> | undefined;
  command: string;
  options?: unknown;
}

interface BrowserHarnessImage {
  exif: null;
  is_edited: boolean;
  is_virtual_copy: boolean;
  modified: number;
  path: string;
  rating: number;
  tags: null;
}

declare global {
  interface ImportMetaEnv {
    VITE_RAWENGINE_AGENT_AUDIT_E2E?: string | undefined;
    VITE_RAWENGINE_BROWSER_TAURI_HARNESS?: string | undefined;
  }

  interface ImportMeta {
    env: ImportMetaEnv;
  }

  interface Window {
    __RAWENGINE_BROWSER_TAURI_HARNESS__?: {
      calls: Array<BrowserTauriInvokeCall>;
      enabled: boolean;
      failNextSettingsSave: boolean;
    };
    __TAURI_INTERNALS__?: BrowserTauriInternals;
    isTauri?: boolean;
  }
}

declare const __RAWENGINE_BROWSER_TAURI_HARNESS__: boolean | undefined;

const harnessEnabled =
  typeof __RAWENGINE_BROWSER_TAURI_HARNESS__ === 'boolean'
    ? __RAWENGINE_BROWSER_TAURI_HARNESS__
    : import.meta.env.VITE_RAWENGINE_BROWSER_TAURI_HARNESS === '1';
const browserHarnessRoot = '/tmp/rawengine-browser-harness';
const agentAuditE2eEnabled = import.meta.env.VITE_RAWENGINE_AGENT_AUDIT_E2E === '1';
const browserHarnessSettingsStorageKey = 'rawengine-browser-tauri-harness-settings-v1';
const commandNames: Record<
  | 'cancelThumbnailGeneration'
  | 'beginImageOpen'
  | 'checkAiConnectorStatus'
  | 'clearSessionCaches'
  | 'exportImages'
  | 'frontendReady'
  | 'generateOriginalTransformedPreview'
  | 'generateUncroppedPreview'
  | 'generatePreviewForPath'
  | 'applyAdjustments'
  | 'applyLibraryCatalogChanges'
  | 'getLensfunMakers'
  | 'getLogFilePath'
  | 'getNativeCapabilities'
  | 'getAlbumImages'
  | 'getFolderTree'
  | 'getFolderRefreshSnapshot'
  | 'getLibraryFolderAggregates'
  | 'getPinnedFolderTrees'
  | 'getSupportedFileTypes'
  | 'isImageCached'
  | 'listImagesInDir'
  | 'listImagesRecursive'
  | 'openLibraryCollection'
  | 'nextLibraryCollectionPage'
  | 'reconcileLibraryCatalog'
  | 'loadImage'
  | 'configureLibraryChangefeed'
  | 'loadMetadata'
  | 'loadPresets'
  | 'loadSettings'
  | 'previewNegativeConversion'
  | 'renderNegativeLabDryRunPreviewArtifact'
  | 'readExifForPaths'
  | 'saveSettings'
  | 'saveMetadataAndUpdateThumbnail'
  | 'scheduleImagePrefetch'
  | 'startBackgroundIndexing'
  | 'testAiConnectorConnection'
  | 'updateThumbnailQueue',
  string
> = {
  beginImageOpen: Invokes.BeginImageOpen,
  applyAdjustments: Invokes.ApplyAdjustments,
  applyLibraryCatalogChanges: Invokes.ApplyLibraryCatalogChanges,
  configureLibraryChangefeed: Invokes.ConfigureLibraryChangefeed,
  cancelThumbnailGeneration: Invokes.CancelThumbnailGeneration,
  checkAiConnectorStatus: Invokes.CheckAIConnectorStatus,
  clearSessionCaches: Invokes.ClearSessionCaches,
  exportImages: Invokes.ExportImages,
  frontendReady: Invokes.FrontendReady,
  generateOriginalTransformedPreview: Invokes.GenerateOriginalTransformedPreview,
  generateUncroppedPreview: Invokes.GenerateUncroppedPreview,
  generatePreviewForPath: Invokes.GeneratePreviewForPath,
  getLensfunMakers: Invokes.GetLensfunMakers,
  getLogFilePath: Invokes.GetLogFilePath,
  getNativeCapabilities: Invokes.GetNativeCapabilities,
  getAlbumImages: Invokes.GetAlbumImages,
  getFolderTree: Invokes.GetFolderTree,
  getFolderRefreshSnapshot: Invokes.GetFolderRefreshSnapshot,
  getLibraryFolderAggregates: Invokes.GetLibraryFolderAggregates,
  getPinnedFolderTrees: Invokes.GetPinnedFolderTrees,
  getSupportedFileTypes: Invokes.GetSupportedFileTypes,
  isImageCached: Invokes.IsImageCached,
  listImagesInDir: Invokes.ListImagesInDir,
  listImagesRecursive: Invokes.ListImagesRecursive,
  openLibraryCollection: Invokes.OpenLibraryCollection,
  nextLibraryCollectionPage: Invokes.NextLibraryCollectionPage,
  reconcileLibraryCatalog: Invokes.ReconcileLibraryCatalog,
  loadImage: Invokes.LoadImage,
  loadMetadata: Invokes.LoadMetadata,
  loadPresets: Invokes.LoadPresets,
  loadSettings: Invokes.LoadSettings,
  previewNegativeConversion: Invokes.PreviewNegativeConversion,
  renderNegativeLabDryRunPreviewArtifact: Invokes.RenderNegativeLabDryRunPreviewArtifact,
  readExifForPaths: Invokes.ReadExifForPaths,
  saveSettings: Invokes.SaveSettings,
  saveMetadataAndUpdateThumbnail: Invokes.SaveMetadataAndUpdateThumbnail,
  scheduleImagePrefetch: Invokes.ScheduleImagePrefetch,
  startBackgroundIndexing: Invokes.StartBackgroundIndexing,
  testAiConnectorConnection: Invokes.TestAIConnectorConnection,
  updateThumbnailQueue: Invokes.UpdateThumbnailQueue,
};

let harnessSettings: AppSettings = {
  lastRootPath: null,
  editorPreviewResolution: 1024,
  libraryViewMode: LibraryViewMode.Flat,
  rootFolders: [],
  theme: Theme.Dark,
  thumbnailSize: ThumbnailSize.Medium,
  useWgpuRenderer: false,
};

const harnessSupportedTypes = {
  nonRaw: ['jpg', 'jpeg', 'png', 'tif', 'tiff'],
  raw: ['arw', 'cr2', 'cr3', 'dng', 'nef', 'raf'],
};
const harnessPreviewJpegBase64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z';

let callbackId = 0;
const callbacks = new Map<number, (event: unknown) => void>();
const eventListeners = new Map<string, Set<number>>();
let folderRevision = 1;
const harnessImages: BrowserHarnessImage[] = [
  {
    exif: null,
    is_edited: false,
    is_virtual_copy: false,
    modified: 0,
    path: `${browserHarnessRoot}/browser-harness.ARW`,
    rating: 0,
    tags: null,
  },
];

const isBrowserTauriEventCallback = (value: unknown): value is BrowserTauriEventCallback => typeof value === 'function';

export const installBrowserTauriHarness = (): void => {
  if (!harnessEnabled || window.__TAURI_INTERNALS__ !== undefined) return;

  const calls: Array<BrowserTauriInvokeCall> = [];
  window.__RAWENGINE_BROWSER_TAURI_HARNESS__ = { calls, enabled: true, failNextSettingsSave: false };
  window.isTauri = true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
  window.__TAURI_INTERNALS__ = {
    convertFileSrc: (filePath) => filePath,
    invoke: (command, args, options) => {
      calls.push({ args, command, options });
      return handleBrowserHarnessInvoke(command, args);
    },
    transformCallback: (callback) => {
      callbackId += 1;
      if (isBrowserTauriEventCallback(callback)) {
        callbacks.set(callbackId, (event) => {
          callback(event);
        });
      }
      return callbackId;
    },
    unregisterCallback: () => {},
  };
};

const handleBrowserHarnessInvoke = (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  switch (command) {
    case commandNames.getNativeCapabilities:
      return Promise.resolve({
        schemaVersion: 1,
        buildProfile: 'full',
        ai: true,
        advancedCodecs: true,
        computational: true,
      });
    case commandNames.loadSettings:
      harnessSettings = readPersistedHarnessSettings();
      return Promise.resolve(harnessSettings);
    case commandNames.saveSettings:
      if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.failNextSettingsSave === true) {
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__.failNextSettingsSave = false;
        return Promise.reject(new Error('Injected Settings save failure'));
      }
      harnessSettings = normalizeHarnessSettings(args?.['settings']);
      window.localStorage.setItem(browserHarnessSettingsStorageKey, JSON.stringify(harnessSettings));
      return Promise.resolve(null);
    case commandNames.frontendReady:
    case commandNames.startBackgroundIndexing:
    case commandNames.updateThumbnailQueue:
    case commandNames.cancelThumbnailGeneration:
    case commandNames.clearSessionCaches:
    case commandNames.saveMetadataAndUpdateThumbnail:
      return Promise.resolve(null);
    case commandNames.exportImages:
      dispatchBrowserHarnessEvent('export-complete', createHarnessExportReceipt(args));
      return Promise.resolve(null);
    case commandNames.isImageCached:
      return Promise.resolve(false);
    case commandNames.loadMetadata:
      return Promise.resolve({ adjustments: null });
    case commandNames.loadPresets:
      return Promise.resolve([]);
    case commandNames.loadImage:
      return Promise.resolve({
        exif: { Make: 'RawEngine Harness', Model: 'Browser Tauri API' },
        height: agentAuditE2eEnabled ? 4 : 768,
        is_raw: true,
        metadata: { harness: true },
        width: agentAuditE2eEnabled ? 4 : 1024,
      });
    case commandNames.beginImageOpen: {
      const request = args?.['request'] as {
        imageId?: string;
        path?: string;
        sessionId?: { imageSession: number; selectionGeneration: number };
      };
      const decoded = {
        exif: { Make: 'RawEngine Harness', Model: 'Browser Tauri API' },
        height: agentAuditE2eEnabled ? 4 : 768,
        is_raw: true,
        metadata: { adjustments: null, harness: true },
        width: agentAuditE2eEnabled ? 4 : 1024,
      };
      return Promise.resolve({
        decodeReadyMillis: 2,
        decoded,
        imageId: request.imageId ?? request.path ?? 'browser-harness-image',
        joinedPrefetch: false,
        metadataFingerprint: '0'.repeat(64),
        metadataReadyMillis: 1,
        sessionId: request.sessionId ?? { imageSession: 0, selectionGeneration: 0 },
      });
    }
    case commandNames.scheduleImagePrefetch:
      return Promise.resolve({
        duplicatePrefetchDrops: 0,
        foregroundOpens: 0,
        metadataReads: 0,
        peakPrefetchInFlight: 0,
        prefetchCancelled: 0,
        prefetchCompleted: 0,
        prefetchPromotions: 0,
        prefetchRequested: 0,
        prefetchStarted: 0,
        stalePhaseDrops: 0,
      });
    case commandNames.applyAdjustments:
      return Promise.resolve(decodeHarnessApplyPreview());
    case commandNames.configureLibraryChangefeed:
      return Promise.resolve(1);
    case commandNames.generateOriginalTransformedPreview:
      return Promise.resolve(`data:image/jpeg;base64,${harnessPreviewJpegBase64}`);
    case commandNames.generateUncroppedPreview:
      return Promise.resolve(null);
    case commandNames.generatePreviewForPath:
      return Promise.resolve(Array.from(new Uint8Array(decodeHarnessApplyPreview())));
    case commandNames.previewNegativeConversion:
      return Promise.resolve(`data:image/jpeg;base64,${harnessPreviewJpegBase64}`);
    case commandNames.renderNegativeLabDryRunPreviewArtifact:
      return Promise.resolve({
        artifactId: 'artifact_negative_lab_runtime_preview_browser_harness',
        baseFogSampleSummary: {
          clippedFraction: 0,
          confidence: 0.81,
          densityRange: 0.07,
          densityRgb: {
            b: 0.55,
            g: 0.51,
            r: 0.48,
          },
          meanRgb: {
            b: 0.2818,
            g: 0.309,
            r: 0.3311,
          },
          sampleCount: 400,
          sampleRect: {
            height: 0.6,
            width: 0.12,
            x: 0.02,
            y: 0.2,
          },
          source: 'deterministic_edge_safe_default_rect',
          warningCodes: [],
        },
        contentHash: 'sha256:d20f6ffd523b78a86cd2f916fa34af5d1918d75f7b142237c752ad6b254213ab',
        densityNormalizationMetrics: {
          axisBounds: {
            color: { max: 0.12, min: -0.12 },
            luma: { max: 1.02, min: -0.03 },
          },
          channelBounds: {
            b: { max: 0.77, min: 0.09 },
            g: { max: 0.74, min: 0.08 },
            r: { max: 0.71, min: 0.07 },
          },
          clippedPixelCount: 0,
          densityRangeUnclamped: 1.04,
          epsilonClampedPixelCount: 0,
          rendererVersion: 1,
        },
        dimensions: {
          height: 1,
          width: 1,
        },
        previewDataUrl: `data:image/jpeg;base64,${harnessPreviewJpegBase64}`,
        renderer: 'rawengine_negative_lab_runtime_preview_v1',
        storage: 'temp_cache',
      });
    case commandNames.checkAiConnectorStatus:
      return Promise.resolve({ connected: false });
    case commandNames.testAiConnectorConnection:
      return Promise.resolve(null);
    case commandNames.getSupportedFileTypes:
      return Promise.resolve(harnessSupportedTypes);
    case commandNames.getFolderTree:
      return Promise.resolve({
        children: [],
        imageCount: 1,
        isDir: true,
        name: browserHarnessRoot.split('/').at(-1) ?? browserHarnessRoot,
        path: browserHarnessRoot,
      });
    case commandNames.getFolderRefreshSnapshot:
      return Promise.resolve({
        fingerprint: `${getStringArg(args, 'path') ?? browserHarnessRoot}:${getBooleanArg(args, 'recursive') ? 'recursive' : 'flat'}:${folderRevision}`,
        itemCount: harnessImages.length,
        path: getStringArg(args, 'path') ?? browserHarnessRoot,
        recursive: getBooleanArg(args, 'recursive'),
      });
    case commandNames.getLibraryFolderAggregates:
      return Promise.resolve(
        getStringArrayArg(args, 'paths').map((path) => ({
          path,
          directImageCount: harnessImages.length,
          recursiveImageCount: harnessImages.length,
          childFolderCount: 0,
          catalogRevision: folderRevision,
        })),
      );
    case commandNames.getPinnedFolderTrees:
      return Promise.resolve(getStringArrayArg(args, 'paths').map(createHarnessFolderTree));
    case commandNames.getLensfunMakers:
      return Promise.resolve([]);
    case commandNames.getLogFilePath:
      return Promise.resolve('/tmp/rawengine-browser-harness/RapidRAW.log');
    case commandNames.listImagesInDir:
    case commandNames.listImagesRecursive:
      return Promise.resolve(harnessImages.map((image) => ({ ...image })));
    case commandNames.openLibraryCollection:
      return Promise.resolve({
        sessionId: 1,
        catalogRevision: folderRevision,
        estimatedCount: harnessImages.length,
        firstPage: harnessImages.map((image, index) => ({ ...image, imageId: image.path, entityRevision: index + 1 })),
        indexingState: 'current',
      });
    case commandNames.nextLibraryCollectionPage:
      return Promise.resolve({ sessionId: 1, catalogRevision: folderRevision, rows: [], complete: true });
    case commandNames.reconcileLibraryCatalog:
      return Promise.resolve({ catalogRevision: ++folderRevision });
    case commandNames.applyLibraryCatalogChanges:
      return Promise.resolve({ catalogRevision: ++folderRevision, upserted: [], removedImageIds: [] });
    case commandNames.readExifForPaths:
      return Promise.resolve({});
    case commandNames.getAlbumImages:
    case 'get_albums':
      return Promise.resolve([]);
    case 'plugin:app|get_version':
    case 'plugin:app|version':
      return Promise.resolve('0.0.0-browser-harness');
    case 'plugin:dialog|open':
      return Promise.resolve(browserHarnessRoot);
    case 'plugin:dialog|save':
      return Promise.resolve(`${browserHarnessRoot}/export.tif`);
    case 'plugin:event|listen':
      return Promise.resolve(registerBrowserHarnessEventListener(args));
    case 'plugin:event|unlisten':
    case 'plugin:shell|open':
      return Promise.resolve(null);
    case 'plugin:os|platform':
      return Promise.resolve('macos');
    case 'plugin:path|resolve_directory':
      return Promise.resolve('/Users/browser-harness');
    case 'plugin:process|restart':
      return Promise.resolve(null);
    default:
      return Promise.reject(new Error(`Unhandled browser Tauri harness command: ${command}`));
  }
};

const normalizeHarnessSettings = (value: unknown): AppSettings => {
  if (value !== null && typeof value === 'object') {
    return { ...harnessSettings, ...(value as Partial<AppSettings>) };
  }

  return harnessSettings;
};

const readPersistedHarnessSettings = (): AppSettings => {
  const raw = window.localStorage.getItem(browserHarnessSettingsStorageKey);
  if (raw === null) return harnessSettings;

  try {
    return normalizeHarnessSettings(JSON.parse(raw));
  } catch {
    return harnessSettings;
  }
};

const registerBrowserHarnessEventListener = (args: Record<string, unknown> | undefined): number => {
  const event = getStringArg(args, 'event');
  const handler = args?.['handler'];
  if (!event || typeof handler !== 'number') return 0;

  const listeners = eventListeners.get(event) ?? new Set<number>();
  listeners.add(handler);
  eventListeners.set(event, listeners);
  return handler;
};

const dispatchBrowserHarnessEvent = (event: string, payload: unknown): void => {
  const listenerIds = eventListeners.get(event);
  if (!listenerIds) return;

  for (const listenerId of listenerIds) {
    callbacks.get(listenerId)?.({ event, id: listenerId, payload });
  }
};

const createHarnessExportReceipt = (args: Record<string, unknown> | undefined) => {
  const paths = getStringArrayArg(args, 'paths');
  const sourcePath = paths[0] ?? `${browserHarnessRoot}/browser-harness.ARW`;
  const outputPath = getStringArg(args, 'outputFolderOrFile') ?? `${browserHarnessRoot}/export.tif`;
  const outputFormat = getStringArg(args, 'outputFormat') ?? 'tif';
  const exportedImage: BrowserHarnessImage = {
    exif: null,
    is_edited: false,
    is_virtual_copy: false,
    modified: folderRevision,
    path: outputPath,
    rating: 0,
    tags: null,
  };

  if (!harnessImages.some((image) => image.path === outputPath)) {
    harnessImages.push(exportedImage);
    folderRevision += 1;
  }

  return {
    completedAt: new Date('2026-06-24T00:00:00.000Z').toISOString(),
    outputs: [
      {
        bitDepth: 16,
        blackPointCompensation: 'enabled',
        byteSize: 143_654_912,
        cmm: 'lcms2',
        colorManagedTransform: 'display-p3 -> srgb',
        colorProfile: 'srgb',
        effectiveColorProfile: 'srgb',
        format: outputFormat,
        iccEmbedded: true,
        outputPath,
        policyStatus: 'applied',
        policyVersion: 'browser-harness-export-policy-v1',
        renderingIntent: 'relativeColorimetric',
        requestedColorProfile: 'srgb',
        requestedRenderingIntent: 'relativeColorimetric',
        resolvedDisabledReason: null,
        effectiveRenderingIntent: 'relativeColorimetric',
        sourcePath,
        transformApplied: true,
      },
    ],
    total: 1,
  };
};

const getStringArg = (args: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = args?.[key];
  return typeof value === 'string' ? value : undefined;
};

const getBooleanArg = (args: Record<string, unknown> | undefined, key: string): boolean => {
  const value = args?.[key];
  return typeof value === 'boolean' ? value : false;
};

const getStringArrayArg = (args: Record<string, unknown> | undefined, key: string): string[] => {
  const value = args?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const createHarnessFolderTree = (path: string) => ({
  children: [],
  imageCount: 1,
  isDir: true,
  name: path.split('/').at(-1) ?? path,
  path,
});

const decodeBase64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const decodeHarnessApplyPreview = (): ArrayBuffer => {
  const buffer = decodeBase64ToArrayBuffer(harnessPreviewJpegBase64);
  if (!agentAuditE2eEnabled) return buffer;
  const bytes = new Uint8Array(buffer);
  const frameIndex = bytes.findIndex((byte, index) => byte === 0xff && bytes[index + 1] === 0xc0);
  if (frameIndex < 0) throw new Error('Browser harness JPEG omitted its baseline frame header.');
  bytes[frameIndex + 5] = 0x06;
  bytes[frameIndex + 6] = 0x00;
  bytes[frameIndex + 7] = 0x06;
  bytes[frameIndex + 8] = 0x00;
  return buffer;
};
