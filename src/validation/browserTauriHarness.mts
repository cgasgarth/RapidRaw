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

declare global {
  interface ImportMetaEnv {
    VITE_RAWENGINE_BROWSER_TAURI_HARNESS?: string | undefined;
  }

  interface ImportMeta {
    env: ImportMetaEnv;
  }

  interface Window {
    __RAWENGINE_BROWSER_TAURI_HARNESS__?: {
      calls: Array<BrowserTauriInvokeCall>;
      enabled: boolean;
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
const browserHarnessSettingsStorageKey = 'rawengine-browser-tauri-harness-settings-v1';
const commandNames: Record<
  | 'cancelThumbnailGeneration'
  | 'checkAiConnectorStatus'
  | 'clearSessionCaches'
  | 'exportImages'
  | 'frontendReady'
  | 'generateOriginalTransformedPreview'
  | 'generateUncroppedPreview'
  | 'generatePreviewForPath'
  | 'applyAdjustments'
  | 'getLensfunMakers'
  | 'getLogFilePath'
  | 'getAlbumImages'
  | 'getFolderTree'
  | 'getFolderRefreshSnapshot'
  | 'getPinnedFolderTrees'
  | 'getSupportedFileTypes'
  | 'isImageCached'
  | 'listImagesInDir'
  | 'listImagesRecursive'
  | 'loadImage'
  | 'loadMetadata'
  | 'loadSettings'
  | 'previewNegativeConversion'
  | 'renderNegativeLabDryRunPreviewArtifact'
  | 'readExifForPaths'
  | 'saveSettings'
  | 'saveMetadataAndUpdateThumbnail'
  | 'startBackgroundIndexing'
  | 'updateThumbnailQueue',
  string
> = {
  applyAdjustments: Invokes.ApplyAdjustments,
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
  getAlbumImages: Invokes.GetAlbumImages,
  getFolderTree: Invokes.GetFolderTree,
  getFolderRefreshSnapshot: Invokes.GetFolderRefreshSnapshot,
  getPinnedFolderTrees: Invokes.GetPinnedFolderTrees,
  getSupportedFileTypes: Invokes.GetSupportedFileTypes,
  isImageCached: Invokes.IsImageCached,
  listImagesInDir: Invokes.ListImagesInDir,
  listImagesRecursive: Invokes.ListImagesRecursive,
  loadImage: Invokes.LoadImage,
  loadMetadata: Invokes.LoadMetadata,
  loadSettings: Invokes.LoadSettings,
  previewNegativeConversion: Invokes.PreviewNegativeConversion,
  renderNegativeLabDryRunPreviewArtifact: Invokes.RenderNegativeLabDryRunPreviewArtifact,
  readExifForPaths: Invokes.ReadExifForPaths,
  saveSettings: Invokes.SaveSettings,
  saveMetadataAndUpdateThumbnail: Invokes.SaveMetadataAndUpdateThumbnail,
  startBackgroundIndexing: Invokes.StartBackgroundIndexing,
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

const isBrowserTauriEventCallback = (value: unknown): value is BrowserTauriEventCallback => typeof value === 'function';

export const installBrowserTauriHarness = (): void => {
  if (!harnessEnabled || window.__TAURI_INTERNALS__ !== undefined) return;

  const calls: Array<BrowserTauriInvokeCall> = [];
  window.__RAWENGINE_BROWSER_TAURI_HARNESS__ = { calls, enabled: true };
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
    case commandNames.loadSettings:
      harnessSettings = readPersistedHarnessSettings();
      return Promise.resolve(harnessSettings);
    case commandNames.saveSettings:
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
    case commandNames.loadImage:
      return Promise.resolve({
        exif: { Make: 'RawEngine Harness', Model: 'Browser Tauri API' },
        height: 768,
        is_raw: true,
        metadata: { harness: true },
        width: 1024,
      });
    case commandNames.applyAdjustments:
      return Promise.resolve(decodeBase64ToArrayBuffer(harnessPreviewJpegBase64));
    case commandNames.generateOriginalTransformedPreview:
      return Promise.resolve(`data:image/jpeg;base64,${harnessPreviewJpegBase64}`);
    case commandNames.generateUncroppedPreview:
      return Promise.resolve(null);
    case commandNames.generatePreviewForPath:
      return Promise.resolve(Array.from(new Uint8Array(decodeBase64ToArrayBuffer(harnessPreviewJpegBase64))));
    case commandNames.previewNegativeConversion:
      return Promise.resolve(`data:image/jpeg;base64,${harnessPreviewJpegBase64}`);
    case commandNames.renderNegativeLabDryRunPreviewArtifact:
      return Promise.resolve({
        artifactId: 'artifact_negative_lab_runtime_preview_browser_harness',
        contentHash: 'sha256:d20f6ffd523b78a86cd2f916fa34af5d1918d75f7b142237c752ad6b254213ab',
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
        fingerprint: `${getStringArg(args, 'path') ?? browserHarnessRoot}:${getBooleanArg(args, 'recursive') ? 'recursive' : 'flat'}`,
        itemCount: 1,
        path: getStringArg(args, 'path') ?? browserHarnessRoot,
        recursive: getBooleanArg(args, 'recursive'),
      });
    case commandNames.getPinnedFolderTrees:
      return Promise.resolve(getStringArrayArg(args, 'paths').map(createHarnessFolderTree));
    case commandNames.getLensfunMakers:
      return Promise.resolve([]);
    case commandNames.getLogFilePath:
      return Promise.resolve('/tmp/rawengine-browser-harness/RapidRAW.log');
    case commandNames.listImagesInDir:
    case commandNames.listImagesRecursive:
      return Promise.resolve([
        {
          exif: null,
          is_edited: false,
          is_virtual_copy: false,
          modified: 0,
          path: `${getStringArg(args, 'path') ?? browserHarnessRoot}/browser-harness.ARW`,
          rating: 0,
          tags: null,
        },
      ]);
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
