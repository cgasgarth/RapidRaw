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
  endedAtMs: number | null;
  options?: unknown;
  startedAtMs: number;
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
      emitEvent: (event: string, payload: unknown) => void;
      failNextSettingsSave: boolean;
    };
    __RAWENGINE_QA_PERFORMANCE_TRACE__?: {
      callIndex: number;
      firstMutationMs: number | null;
      lastMutationMs: number | null;
      mutationCount: number;
      observer: MutationObserver;
      startedAtMs: number;
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
  | 'getStartupTrace'
  | 'recordFrontendStartupPhase'
  | 'generateOriginalTransformedPreview'
  | 'generateMaskOverlay'
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
  | 'importFiles'
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
  | 'mergeHdr'
  | 'previewNegativeConversion'
  | 'planHdr'
  | 'renderNegativeLabDryRunPreviewArtifact'
  | 'preflightNegativeLabSource'
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
  getStartupTrace: Invokes.GetStartupTrace,
  recordFrontendStartupPhase: Invokes.RecordFrontendStartupPhase,
  generateOriginalTransformedPreview: Invokes.GenerateOriginalTransformedPreview,
  generateMaskOverlay: Invokes.GenerateMaskOverlay,
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
  importFiles: Invokes.ImportFiles,
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
  mergeHdr: Invokes.MergeHdr,
  previewNegativeConversion: Invokes.PreviewNegativeConversion,
  planHdr: Invokes.PlanHdr,
  renderNegativeLabDryRunPreviewArtifact: Invokes.RenderNegativeLabDryRunPreviewArtifact,
  preflightNegativeLabSource: Invokes.PreflightNegativeLabSource,
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
let catalogCursor = 0;
let catalogPageSize = 256;
let harnessImages: BrowserHarnessImage[] = [
  {
    exif: null,
    is_edited: false,
    is_virtual_copy: false,
    modified: 0,
    path: `${browserHarnessRoot}/browser-harness.ARW`,
    rating: 0,
    tags: null,
  },
  {
    exif: null,
    is_edited: false,
    is_virtual_copy: false,
    modified: 1_000_000,
    path: `${browserHarnessRoot}/browser-harness-2.ARW`,
    rating: 0,
    tags: null,
  },
  {
    exif: null,
    is_edited: false,
    is_virtual_copy: false,
    modified: 2_000_000,
    path: `${browserHarnessRoot}/browser-harness-3.ARW`,
    rating: 0,
    tags: null,
  },
];

const isBrowserTauriEventCallback = (value: unknown): value is BrowserTauriEventCallback => typeof value === 'function';

export const installBrowserTauriHarness = (): void => {
  if (!harnessEnabled || window.__TAURI_INTERNALS__ !== undefined) return;

  const requestedImageCount = Number.parseInt(new URL(window.location.href).searchParams.get('qaImages') ?? '', 10);
  if (Number.isInteger(requestedImageCount) && requestedImageCount >= 1 && requestedImageCount <= 100_000) {
    harnessImages = Array.from({ length: requestedImageCount }, (_, index) => ({
      exif: null,
      is_edited: false,
      is_virtual_copy: false,
      modified: index * 1_000_000,
      path:
        index === 0
          ? `${browserHarnessRoot}/browser-harness.ARW`
          : `${browserHarnessRoot}/browser-harnessz-${String(index + 1).padStart(6, '0')}.ARW`,
      rating: 0,
      tags: null,
    }));
  }

  const calls: Array<BrowserTauriInvokeCall> = [];
  const emitEvent = (event: string, payload: unknown) => {
    for (const callbackId of eventListeners.get(event) ?? [])
      callbacks.get(callbackId)?.({ event, id: callbackId, payload });
  };
  window.__RAWENGINE_BROWSER_TAURI_HARNESS__ = { calls, emitEvent, enabled: true, failNextSettingsSave: false };
  window.isTauri = true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
  window.__TAURI_INTERNALS__ = {
    convertFileSrc: (filePath) => filePath,
    invoke: (command, args, options) => {
      const call: BrowserTauriInvokeCall = {
        args,
        command,
        endedAtMs: null,
        options,
        startedAtMs: performance.now(),
      };
      calls.push(call);
      return handleBrowserHarnessInvoke(command, args).finally(() => {
        call.endedAtMs = performance.now();
      });
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
    case commandNames.importFiles: {
      const sourcePaths = getStringArrayArg(args, 'sourcePaths');
      const destinationFolder = getStringArg(args, 'destinationFolder') ?? browserHarnessRoot;
      const jobId = 'browser-harness-import-job';
      window.setTimeout(() => dispatchBrowserHarnessEvent('import-start', { jobId, total: sourcePaths.length }), 0);
      sourcePaths.forEach((sourcePath, index) => {
        const importedPath = `${destinationFolder}/${sourcePath.split('/').at(-1) ?? `import-${index + 1}.ARW`}`;
        if (!harnessImages.some(({ path }) => path === importedPath)) {
          harnessImages.push({
            exif: null,
            is_edited: false,
            is_virtual_copy: false,
            modified: folderRevision + index + 1,
            path: importedPath,
            rating: 0,
            tags: null,
          });
        }
        window.setTimeout(
          () =>
            dispatchBrowserHarnessEvent('import-progress', {
              bytesCopied: (index + 1) * 24_000_000,
              committedPath: importedPath,
              current: index + 1,
              path: importedPath,
              stage: 'copy',
              total: sourcePaths.length,
              totalBytes: sourcePaths.length * 24_000_000,
            }),
          20 * (index + 1),
        );
      });
      folderRevision += sourcePaths.length;
      window.setTimeout(() => dispatchBrowserHarnessEvent('import-complete', { jobId }), 20 * (sourcePaths.length + 1));
      return Promise.resolve(jobId);
    }
    case commandNames.planHdr: {
      const paths = getStringArrayArg(args, 'paths');
      return Promise.resolve({
        accepted: true,
        acceptedDryRunPlanHash: 'blake3:browser-harness-hdr-plan',
        acceptedDryRunPlanId: 'hdr_runtime_plan_browser_harness',
        blockCodes: [],
        bracketCount: paths.length,
        previewDimensions: { height: 768, width: 1024 },
        readiness: 'static_radiance_preview_ready',
        sourcePaths: paths,
        sources: paths.map((path, sourceIndex) => ({
          contentHash: `blake3:browser-harness-hdr-source-${sourceIndex}`,
          dimensions: { height: 768, width: 1024 },
          exposure: { exposureEv: sourceIndex - 1, exposureTimeSeconds: 0.008 * 2 ** sourceIndex, iso: 100 },
          path,
          sourceIndex,
        })),
        warningCodes: [],
      });
    }
    case commandNames.mergeHdr: {
      const paths = getStringArrayArg(args, 'paths');
      dispatchBrowserHarnessEvent('hdr-complete', {
        base64: `data:image/jpeg;base64,${harnessPreviewJpegBase64}`,
        receipt: {
          acceptedDryRunPlanHash: getStringArg(args, 'acceptedDryRunPlanHash') ?? 'blake3:browser-harness-hdr-plan',
          acceptedDryRunPlanId: getStringArg(args, 'acceptedDryRunPlanId') ?? 'hdr_runtime_plan_browser_harness',
          mergeMethod: 'exposure_weighted_radiance',
          mergeVersion: 'browser-harness-v1',
          outputContentHash: 'blake3:browser-harness-hdr-output',
          outputHandle: 'memory:browser-harness-hdr-output',
          previewDimensions: { height: 768, width: 1024 },
          sourceRoles: paths.map((_, sourceIndex) => ({
            exposureEv: sourceIndex - 1,
            role: sourceIndex === 0 ? 'under_exposed' : sourceIndex === paths.length - 1 ? 'over_exposed' : 'reference',
            sourceIndex,
          })),
          sourcePaths: paths,
          warningCodes: [],
        },
      });
      return Promise.resolve(null);
    }
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
      dispatchBrowserHarnessEvent('image-open-update', {
        dataUrl: `data:image/jpeg;base64,${harnessPreviewJpegBase64}`,
        imageId: request.imageId ?? request.path ?? 'browser-harness-image',
        path: request.path ?? '/tmp/rawengine-browser-harness/image.raw',
        phase: 'frameReady',
        receipt: {
          colorAssumption: 'encoded_srgb_vendor_preview',
          frameGeneration: 1,
          height: decoded.height,
          imageSession: request.sessionId?.imageSession ?? 0,
          orientationApplied: false,
          provisionalReason: 'camera-rendered latency bridge; not authoritative pixels',
          quality: 'embeddedProvisional',
          selectionGeneration: request.sessionId?.selectionGeneration ?? 0,
          sourceKind: 'browser_harness_raw',
          sourceRevision: `source-revision-v1:${'0'.repeat(64)}`,
          width: decoded.width,
        },
        sessionId: request.sessionId ?? { imageSession: 0, selectionGeneration: 0 },
      });
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            decodeReadyMillis: 250,
            decoded,
            imageId: request.imageId ?? request.path ?? 'browser-harness-image',
            joinedPrefetch: false,
            metadataFingerprint: '0'.repeat(64),
            metadataReadyMillis: 1,
            sessionId: request.sessionId ?? { imageSession: 0, selectionGeneration: 0 },
          });
        }, 250);
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
      return createHarnessApplyPreview(args);
    case commandNames.configureLibraryChangefeed:
      return Promise.resolve(1);
    case commandNames.generateOriginalTransformedPreview:
    case commandNames.generateMaskOverlay:
      return Promise.resolve(`data:image/jpeg;base64,${harnessPreviewJpegBase64}`);
    case commandNames.generateUncroppedPreview:
      return Promise.resolve(null);
    case commandNames.generatePreviewForPath:
      return Promise.resolve(Array.from(new Uint8Array(decodeHarnessApplyPreview())));
    case commandNames.previewNegativeConversion:
      return Promise.resolve(`data:image/jpeg;base64,${harnessPreviewJpegBase64}`);
    case commandNames.preflightNegativeLabSource:
      return Promise.resolve({
        appliedLinearization: 'identity_declared_by_decoder',
        bitDepth: 32,
        blockReasons: [],
        confidence: 0.9,
        decoderBackend: 'browser_harness',
        decoderVersion: 'browser_harness_v1',
        dimensions: { height: 1, width: 1 },
        embeddedIccProfile: false,
        interpretationHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        nonFiniteFraction: 0,
        orientation: 'unknown',
        rawDemosaicMode: null,
        sampleFormat: 'Rgb32F',
        schemaVersion: 1,
        sourceHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        sourceType: 'linear_tiff_candidate',
        transferFunction: 'unproven',
        warningCodes: ['linear_transfer_unproven'],
      });
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
        autoMeter: {
          algorithmId: 'native_negative_lab_auto_meter_v1',
          algorithmVersion: 1,
          sampleCount: 400,
          lumaDensityP10: 0.18,
          lumaDensityP50: 0.42,
          lumaDensityP90: 0.76,
          texturalDensityRangeP10P90: 0.58,
          boundedDensityRange: 0.58,
          confidence: 0.91,
          confidenceThreshold: 0.58,
          requestedAutoDensityEnabled: false,
          requestedAutoDensityStrength: 1,
          requestedAutoGradeEnabled: false,
          requestedAutoGradeStrength: 1,
          appliedDensityOffset: 0,
          effectiveIsoRGrade: 1,
          densityApplied: false,
          gradeApplied: false,
          warningCodes: [],
        },
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
    case commandNames.getStartupTrace:
      return Promise.resolve({
        criticalPathOrderValid: true,
        firstPaintBudgetMet: true,
        firstPaintBudgetMs: 750,
        processId: 12_345,
        traceId: 'startup:browser-harness',
        phases: [],
      });
    case commandNames.recordFrontendStartupPhase: {
      const receiptPhase = {
        editorReady: 'frontendEditorReady',
        interactive: 'frontendInteractive',
        libraryReady: 'frontendLibraryReady',
        libraryViewportVisible: 'frontendLibraryViewportVisible',
        settingsHydrated: 'frontendSettingsHydrated',
        shellVisible: 'frontendShellVisible',
      }[String(args?.['phase'])];
      return Promise.resolve({
        criticalPathOrderValid: true,
        firstPaintBudgetMet: true,
        firstPaintBudgetMs: 750,
        processId: 12_345,
        traceId: 'startup:browser-harness',
        phases: [
          {
            detail: args?.['detail'] ?? null,
            elapsedMs: 10,
            phase: receiptPhase,
            status: args?.['status'],
          },
        ],
      });
    }
    case commandNames.getFolderTree:
      return Promise.resolve({
        children: [
          {
            children: [
              {
                children: [],
                imageCount: 2,
                isDir: true,
                name: 'Selects',
                path: `${browserHarnessRoot}/Alaska/Selects`,
              },
            ],
            imageCount: 3,
            isDir: true,
            name: 'Alaska',
            path: `${browserHarnessRoot}/Alaska`,
          },
        ],
        imageCount: harnessImages.length,
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
      catalogCursor = 0;
      {
        const requestedPageSize = args?.['requestedPageSize'];
        catalogPageSize = Math.max(
          1,
          Math.min(
            1_024,
            typeof requestedPageSize === 'number' && Number.isInteger(requestedPageSize) ? requestedPageSize : 256,
          ),
        );
        catalogCursor = Math.min(catalogPageSize, harnessImages.length);
        return Promise.resolve({
          sessionId: 1,
          catalogRevision: folderRevision,
          estimatedCount: harnessImages.length,
          firstPage: harnessImages
            .slice(0, catalogCursor)
            .map((image, index) => ({ ...image, imageId: image.path, entityRevision: index + 1 })),
          indexingState: 'current',
        });
      }
    case commandNames.nextLibraryCollectionPage: {
      const start = catalogCursor;
      const end = Math.min(start + catalogPageSize, harnessImages.length);
      catalogCursor = end;
      return Promise.resolve({
        sessionId: 1,
        catalogRevision: folderRevision,
        rows: harnessImages
          .slice(start, end)
          .map((image, index) => ({ ...image, imageId: image.path, entityRevision: start + index + 1 })),
        complete: end >= harnessImages.length,
      });
    }
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
    case 'plugin:dialog|open': {
      const options = args?.['options'];
      return Promise.resolve(
        options && typeof options === 'object' && Reflect.get(options, 'multiple') === true
          ? [1, 2, 3, 4, 5, 6].map((index) => `${browserHarnessRoot}/import-source-${index}.ARW`)
          : browserHarnessRoot,
      );
    }
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
  const outputPath = getStringArg(args, 'outputFolderOrFile') ?? `${browserHarnessRoot}/export.tif`;
  const outputFormat = getStringArg(args, 'outputFormat') ?? 'tif';
  const sourcePaths = paths.length > 0 ? paths : [`${browserHarnessRoot}/browser-harness.ARW`];
  const outputs = sourcePaths.map((sourcePath, index) => {
    const resolvedOutputPath =
      sourcePaths.length === 1
        ? outputPath
        : `${outputPath}/${
            sourcePath
              .split('/')
              .at(-1)
              ?.replace(/\.[^.]+$/u, '') ?? `export-${index + 1}`
          }.${outputFormat}`;
    if (!harnessImages.some((image) => image.path === resolvedOutputPath)) {
      harnessImages.push({
        exif: null,
        is_edited: false,
        is_virtual_copy: false,
        modified: folderRevision + index + 1,
        path: resolvedOutputPath,
        rating: 0,
        tags: null,
      });
    }
    return {
      bitDepth: 16,
      blackPointCompensation: 'enabled',
      byteSize: 143_654_912,
      cmm: 'lcms2',
      colorManagedTransform: 'display-p3 -> srgb',
      colorProfile: 'srgb',
      effectiveColorProfile: 'srgb',
      format: outputFormat,
      iccEmbedded: true,
      outputPath: resolvedOutputPath,
      policyStatus: 'applied',
      policyVersion: 'browser-harness-export-policy-v1',
      renderingIntent: 'relativeColorimetric',
      requestedColorProfile: 'srgb',
      requestedRenderingIntent: 'relativeColorimetric',
      resolvedDisabledReason: null,
      effectiveRenderingIntent: 'relativeColorimetric',
      sourcePath,
      transformApplied: true,
    };
  });
  folderRevision += outputs.length;

  return {
    completedAt: new Date('2026-06-24T00:00:00.000Z').toISOString(),
    outputs,
    terminalStatus: 'completed',
    total: outputs.length,
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

interface HarnessApplyPreviewRequest {
  isInteractive: boolean;
  roi: [number, number, number, number] | null;
  targetResolution: number;
}

const normalizeHarnessApplyPreviewRequest = (args: Record<string, unknown> | undefined): HarnessApplyPreviewRequest => {
  const candidate = args?.['request'];
  const request = typeof candidate === 'object' && candidate !== null ? (candidate as Record<string, unknown>) : {};
  const roiCandidate = request['roi'];
  const roi =
    Array.isArray(roiCandidate) &&
    roiCandidate.length === 4 &&
    roiCandidate.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
      ? ([roiCandidate[0], roiCandidate[1], roiCandidate[2], roiCandidate[3]] as [number, number, number, number])
      : null;
  const requestedResolution = request['targetResolution'];
  return {
    isInteractive: request['isInteractive'] === true,
    roi,
    targetResolution:
      typeof requestedResolution === 'number' && Number.isFinite(requestedResolution)
        ? Math.min(4096, Math.max(1, Math.round(requestedResolution)))
        : 1024,
  };
};

const encodeHarnessPreviewJpeg = async (
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): Promise<ArrayBuffer> => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Browser harness could not create preview canvas context.');
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `rgb(${String(48 + (offsetX % 80))}, 88, 136)`);
  gradient.addColorStop(1, `rgb(168, ${String(104 + (offsetY % 80))}, 64)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value === null ? reject(new Error('Browser harness JPEG encode failed.')) : resolve(value)),
      'image/jpeg',
      0.9,
    );
  });
  return blob.arrayBuffer();
};

const createHarnessApplyPreview = async (args: Record<string, unknown> | undefined): Promise<ArrayBuffer> => {
  const request = normalizeHarnessApplyPreviewRequest(args);
  if (agentAuditE2eEnabled || (!request.isInteractive && request.roi === null)) {
    return decodeHarnessApplyPreview();
  }

  const fullWidth = request.targetResolution;
  const fullHeight = Math.max(1, Math.round((fullWidth * 3) / 4));
  const [normX, normY, normWidth, normHeight] = request.roi ?? [0, 0, 1, 1];
  const x = Math.min(fullWidth - 1, Math.max(0, Math.round(normX * fullWidth)));
  const y = Math.min(fullHeight - 1, Math.max(0, Math.round(normY * fullHeight)));
  const width = Math.min(fullWidth - x, Math.max(1, Math.round(normWidth * fullWidth)));
  const height = Math.min(fullHeight - y, Math.max(1, Math.round(normHeight * fullHeight)));
  const jpeg = await encodeHarnessPreviewJpeg(width, height, x, y);
  const response = new ArrayBuffer(24 + jpeg.byteLength);
  const view = new DataView(response);
  for (const [index, value] of [x, y, width, height, fullWidth, fullHeight].entries()) {
    view.setUint32(index * 4, value, true);
  }
  new Uint8Array(response, 24).set(new Uint8Array(jpeg));
  return response;
};
