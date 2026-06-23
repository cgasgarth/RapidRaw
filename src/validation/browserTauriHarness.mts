import { Invokes, LibraryViewMode, Theme, ThumbnailSize, type AppSettings } from '../components/ui/AppProperties.tsx';

type BrowserTauriInvoke = (command: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;

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
  interface Window {
    __RAWENGINE_BROWSER_TAURI_HARNESS__?: {
      calls: Array<BrowserTauriInvokeCall>;
      enabled: boolean;
    };
    __TAURI_INTERNALS__?: BrowserTauriInternals;
    isTauri?: boolean;
  }
}

declare const __RAWENGINE_BROWSER_TAURI_HARNESS__: boolean;

const harnessEnabled = __RAWENGINE_BROWSER_TAURI_HARNESS__;
const browserHarnessRoot = '/tmp/rawengine-browser-harness';
const commandNames: Record<
  | 'cancelThumbnailGeneration'
  | 'checkAiConnectorStatus'
  | 'frontendReady'
  | 'getAlbumImages'
  | 'getFolderTree'
  | 'getPinnedFolderTrees'
  | 'getSupportedFileTypes'
  | 'listImagesInDir'
  | 'listImagesRecursive'
  | 'loadSettings'
  | 'readExifForPaths'
  | 'saveSettings'
  | 'startBackgroundIndexing'
  | 'updateThumbnailQueue',
  string
> = {
  cancelThumbnailGeneration: Invokes.CancelThumbnailGeneration,
  checkAiConnectorStatus: Invokes.CheckAIConnectorStatus,
  frontendReady: Invokes.FrontendReady,
  getAlbumImages: Invokes.GetAlbumImages,
  getFolderTree: Invokes.GetFolderTree,
  getPinnedFolderTrees: Invokes.GetPinnedFolderTrees,
  getSupportedFileTypes: Invokes.GetSupportedFileTypes,
  listImagesInDir: Invokes.ListImagesInDir,
  listImagesRecursive: Invokes.ListImagesRecursive,
  loadSettings: Invokes.LoadSettings,
  readExifForPaths: Invokes.ReadExifForPaths,
  saveSettings: Invokes.SaveSettings,
  startBackgroundIndexing: Invokes.StartBackgroundIndexing,
  updateThumbnailQueue: Invokes.UpdateThumbnailQueue,
};

const harnessSettings: AppSettings = {
  lastRootPath: null,
  libraryViewMode: LibraryViewMode.Flat,
  rootFolders: [],
  theme: Theme.Dark,
  thumbnailSize: ThumbnailSize.Medium,
};

const harnessSupportedTypes = {
  nonRaw: ['jpg', 'jpeg', 'png', 'tif', 'tiff'],
  raw: ['arw', 'cr2', 'cr3', 'dng', 'nef', 'raf'],
};

let callbackId = 0;

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
    transformCallback: () => {
      callbackId += 1;
      return callbackId;
    },
    unregisterCallback: () => {},
  };
};

const handleBrowserHarnessInvoke = (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  switch (command) {
    case commandNames.loadSettings:
      return Promise.resolve(harnessSettings);
    case commandNames.saveSettings:
    case commandNames.frontendReady:
    case commandNames.startBackgroundIndexing:
    case commandNames.updateThumbnailQueue:
    case commandNames.cancelThumbnailGeneration:
      return Promise.resolve(null);
    case commandNames.checkAiConnectorStatus:
      return Promise.resolve({ connected: false });
    case commandNames.getSupportedFileTypes:
      return Promise.resolve(harnessSupportedTypes);
    case commandNames.getFolderTree:
      return Promise.resolve({
        children: [],
        imageCount: 1,
        name: browserHarnessRoot.split('/').at(-1) ?? browserHarnessRoot,
        path: browserHarnessRoot,
      });
    case commandNames.getPinnedFolderTrees:
      return Promise.resolve([]);
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
      return Promise.resolve(1);
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

const getStringArg = (args: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = args?.[key];
  return typeof value === 'string' ? value : undefined;
};
