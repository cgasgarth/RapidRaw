import { editDocumentV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2.ts';
import { type AppSettings, LibraryViewMode, Theme, ThumbnailSize } from '../components/ui/AppProperties.tsx';
import { Invokes } from '../tauri/commands.ts';
import { INITIAL_ADJUSTMENTS } from '../utils/adjustments.ts';
import { type PreviewOperationIdentity, previewOperationIdentitySchema } from '../utils/previewCoordinator.ts';
import { createBrowserHarnessImportLifecycle } from './browserHarnessImportEvents.ts';
import type {
  BrowserHarnessImage,
  BrowserTauriEventCallback,
  BrowserTauriInvokeCall,
} from './browserTauriHarnessContract';

declare global {
  interface ImportMetaEnv {
    VITE_RAWENGINE_AGENT_AUDIT_E2E?: string | undefined;
    VITE_RAWENGINE_BROWSER_TAURI_HARNESS?: string | undefined;
  }

  interface ImportMeta {
    env: ImportMetaEnv;
  }
}

const browserHarnessRoot = '/tmp/rawengine-browser-harness';
const agentAuditE2eEnabled = import.meta.env.VITE_RAWENGINE_AGENT_AUDIT_E2E === '1';
const browserHarnessSettingsStorageKey = 'rawengine-browser-tauri-harness-settings-v1';
const commandNames: Record<
  | 'analyzeAutoEdit'
  | 'analyzePerspectiveCorrection'
  | 'analyzeToneEqualizerPlacement'
  | 'calculateAutoAdjustments'
  | 'applyAutoAdjustmentsToPaths'
  | 'commitBatchAutoAdjustment'
  | 'applyAutoEditProposal'
  | 'cancelAutoEditAnalysis'
  | 'cancelBackgroundIndexing'
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
  | 'generateAiSubjectMask'
  | 'invokeGenerativeReplaceWithMaskDef'
  | 'generateUncroppedPreview'
  | 'generatePreviewForPath'
  | 'applyAdjustments'
  | 'applyAdjustmentsToPaths'
  | 'applyLibraryCatalogChanges'
  | 'getLensfunMakers'
  | 'getLensfunLensesForMaker'
  | 'getLensDistortionParams'
  | 'autodetectLens'
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
  | 'precomputeAiSubjectMask'
  | 'previewAutoEditProposal'
  | 'planHdr'
  | 'renderNegativeLabDryRunPreviewArtifact'
  | 'preflightNegativeLabSource'
  | 'readExifForPaths'
  | 'resetAdjustmentsForPaths'
  | 'resolveOriginalSourceIdentity'
  | 'saveSettings'
  | 'saveMetadataAndUpdateThumbnail'
  | 'samplePointColorPicker'
  | 'sampleToneEqualizerPicker'
  | 'sampleViewerPixel'
  | 'scheduleImagePrefetch'
  | 'startBackgroundIndexing'
  | 'testAiConnectorConnection'
  | 'updateThumbnailQueue',
  string
> = {
  analyzeAutoEdit: Invokes.AnalyzeAutoEdit,
  analyzePerspectiveCorrection: Invokes.AnalyzePerspectiveCorrection,
  analyzeToneEqualizerPlacement: Invokes.AnalyzeToneEqualizerPlacement,
  calculateAutoAdjustments: Invokes.CalculateAutoAdjustments,
  applyAutoAdjustmentsToPaths: Invokes.ApplyAutoAdjustmentsToPaths,
  commitBatchAutoAdjustment: Invokes.CommitBatchAutoAdjustment,
  applyAutoEditProposal: Invokes.ApplyAutoEditProposal,
  beginImageOpen: Invokes.BeginImageOpen,
  applyAdjustments: Invokes.ApplyAdjustments,
  applyAdjustmentsToPaths: Invokes.ApplyAdjustmentsToPaths,
  applyLibraryCatalogChanges: Invokes.ApplyLibraryCatalogChanges,
  configureLibraryChangefeed: Invokes.ConfigureLibraryChangefeed,
  cancelThumbnailGeneration: Invokes.CancelThumbnailGeneration,
  cancelBackgroundIndexing: Invokes.CancelBackgroundIndexing,
  cancelAutoEditAnalysis: Invokes.CancelAutoEditAnalysis,
  checkAiConnectorStatus: Invokes.CheckAIConnectorStatus,
  clearSessionCaches: Invokes.ClearSessionCaches,
  exportImages: Invokes.ExportImages,
  frontendReady: Invokes.FrontendReady,
  getStartupTrace: Invokes.GetStartupTrace,
  recordFrontendStartupPhase: Invokes.RecordFrontendStartupPhase,
  generateOriginalTransformedPreview: Invokes.GenerateOriginalTransformedPreview,
  generateMaskOverlay: Invokes.GenerateMaskOverlay,
  generateAiSubjectMask: Invokes.GenerateAiSubjectMask,
  invokeGenerativeReplaceWithMaskDef: Invokes.InvokeGenerativeReplaceWithMaskDef,
  generateUncroppedPreview: Invokes.GenerateUncroppedPreview,
  generatePreviewForPath: Invokes.GeneratePreviewForPath,
  getLensfunMakers: Invokes.GetLensfunMakers,
  getLensfunLensesForMaker: Invokes.GetLensfunLensesForMaker,
  getLensDistortionParams: Invokes.GetLensDistortionParams,
  autodetectLens: Invokes.AutodetectLens,
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
  precomputeAiSubjectMask: Invokes.PrecomputeAiSubjectMask,
  previewAutoEditProposal: Invokes.PreviewAutoEditProposal,
  planHdr: Invokes.PlanHdr,
  renderNegativeLabDryRunPreviewArtifact: Invokes.RenderNegativeLabDryRunPreviewArtifact,
  preflightNegativeLabSource: Invokes.PreflightNegativeLabSource,
  readExifForPaths: Invokes.ReadExifForPaths,
  resetAdjustmentsForPaths: Invokes.ResetAdjustmentsForPaths,
  resolveOriginalSourceIdentity: Invokes.ResolveOriginalSourceIdentity,
  saveSettings: Invokes.SaveSettings,
  saveMetadataAndUpdateThumbnail: Invokes.SaveMetadataAndUpdateThumbnail,
  samplePointColorPicker: Invokes.SamplePointColorPicker,
  sampleToneEqualizerPicker: Invokes.SampleToneEqualizerPicker,
  sampleViewerPixel: Invokes.SampleViewerPixel,
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

const createHarnessAutoAdjustments = (exposure: number): Record<string, unknown> => ({
  blacks: -4,
  brightness: 1.2,
  clarity: 8,
  contrast: 18,
  dehaze: 5,
  exposure,
  highlights: -10,
  effectsEnabled: true,
  shadows: 12,
  vibrance: 16,
  vignetteAmount: -3,
  whiteBalanceTechnical: {
    adaptation: 'cat16_v1',
    confidence: 0.8,
    contract: 'rapidraw.white_balance.v1',
    duv: 0,
    inputSemantics: 'raw_scene_linear',
    kelvin: 6504,
    mode: 'auto',
    sampleCount: 256,
    source: 'auto',
    presetId: null,
    synchronization: { mode: 'per_image', referenceSourceIdentity: null },
    x: 0.31271,
    y: 0.32902,
  },
  whites: 6,
  centré: 2,
});

let callbackId = 0;
const callbacks = new Map<number, (event: unknown) => void>();
const eventListeners = new Map<string, Set<number>>();
let folderRevision = 1;
let catalogCursor = 0;
let thumbnailOperationId = 0;
let catalogIndexingOperationId = 0;
let catalogPageSize = 256;
let batchAutoAdjustInvocation = 0;
const harnessAdjustmentsByPath = new Map<string, unknown>();
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

const roundTripTauriJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

export const installBrowserTauriHarness = (): void => {
  if (window.__TAURI_INTERNALS__ !== undefined) return;

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
  window.__RAWENGINE_BROWSER_TAURI_HARNESS__ = {
    aiSubjectMaskResponses: [],
    applyAdjustmentsToPathsDelayMs: 0,
    applyPreviewResponses: [],
    autoAdjustResponses: [],
    batchAutoAdjustCommitDelayMs: 0,
    batchAutoAdjustPrepareDelayMs: 0,
    calls,
    emitEvent,
    enabled: true,
    failNextSettingsSave: false,
    imageOpenDelayMs: 250,
    lensDistortionResponses: [],
    metadataSaveResponses: [],
    originalPreviewResponses: [],
    resetAdjustmentsResponses: [],
    perspectiveAnalysisResponses: [],
    revokedObjectUrls: [],
    tonePlacementResponses: [],
    viewerSampleResponses: [],
    setAdjustmentsForPath: (path, adjustments) => {
      harnessAdjustmentsByPath.set(path, structuredClone(adjustments));
    },
  };
  window.isTauri = true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
  window.__TAURI_INTERNALS__ = {
    convertFileSrc: (filePath) =>
      filePath.startsWith(browserHarnessRoot) ? `data:image/jpeg;base64,${harnessPreviewJpegBase64}` : filePath,
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
    case commandNames.resetAdjustmentsForPaths: {
      const paths = getStringArrayArg(args, 'paths');
      const response = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.resetAdjustmentsResponses.shift() ?? {
        delayMs: 0,
        value: paths.map((path) => ({
          adjustments: {},
          path,
          renderGeneration: 1,
          revision: `sha256:${'b'.repeat(64)}`,
        })),
      };
      return new Promise((resolve) =>
        window.setTimeout(() => resolve(structuredClone(response.value)), response.delayMs),
      );
    }
    case commandNames.calculateAutoAdjustments: {
      const response = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.autoAdjustResponses.shift() ?? {
        delayMs: 0,
        value: createHarnessAutoAdjustments(0.35),
      };
      return new Promise((resolve, reject) => {
        window.setTimeout(() => {
          if (response.failure !== undefined) reject(new Error(response.failure));
          else resolve(structuredClone(response.value));
        }, response.delayMs);
      });
    }
    case commandNames.resolveOriginalSourceIdentity: {
      const path = getStringArg(args, 'path') ?? '';
      let hash = 0xcbf29ce484222325n;
      for (const byte of new TextEncoder().encode(path)) {
        hash ^= BigInt(byte);
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
      }
      return Promise.resolve({
        available: path.length > 0,
        sourceRevision: path.length > 0 ? `source-revision-v1:${hash.toString(16).padStart(16, '0').repeat(4)}` : null,
      });
    }
    case commandNames.analyzePerspectiveCorrection: {
      const response = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.perspectiveAnalysisResponses.shift();
      const matrix = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const analysisIdentity = {
        analysisDimensions: [1024, 768],
        implementationVersion: 1,
        lensGeometryFingerprint: 2,
        orientationFingerprint: 3,
        sourceRevision: 4,
      };
      const value = response?.value ?? {
        analysis: {
          confidence: 0.92,
          horizonAngleDegrees: 1.5,
          identity: analysisIdentity,
          lines: [],
          warningCodes: [],
        },
        receipt: {
          abstentionReason: null,
          conditionEstimate: 1,
          guideCount: 0,
          horizontalGuideCount: 0,
          plan: {
            analysisIdentity,
            confidence: 0.92,
            correctedToSource: matrix,
            fingerprint: 42,
            implementationVersion: 1,
            retainedArea: 0.81,
            sourceToCorrected: matrix,
            suggestedCrop: { height: 0.8, width: 0.8, x: 0.1, y: 0.1 },
            validPolygon: [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            warningCodes: [],
          },
          residualDegreesP95: 0.25,
          verticalGuideCount: 0,
        },
      };
      return new Promise((resolve) => window.setTimeout(() => resolve(value), response?.delayMs ?? 0));
    }
    case commandNames.analyzeToneEqualizerPlacement: {
      const sourceIdentity =
        getStringArg(args, 'expectedSourceIdentity') ?? `${browserHarnessRoot}/browser-harness.ARW`;
      const response = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.tonePlacementResponses.shift() ?? {
        delayMs: 0,
        value: {
          confidence: 0.86,
          histogram: Array.from({ length: 32 }, (_, index) => index + 1),
          pivotEv: 0.5,
          rangeEv: 12,
          sceneBlackEv: -6,
          sceneWhiteEv: 6,
          sourceFingerprint: '0123456789abcdef',
          sourceIdentity,
        },
      };
      return new Promise((resolve, reject) => {
        window.setTimeout(() => {
          if (response.failure !== undefined) reject(new Error(response.failure));
          else resolve(response.value);
        }, response.delayMs);
      });
    }
    case commandNames.analyzeAutoEdit: {
      const request = args?.['request'] as { graphRevision?: string; imageSessionId?: string } | undefined;
      return Promise.resolve({
        analysisIdentity: {
          analysisDomain: 'raw_scene_linear',
          analysisResolution: [1024, 768],
          cameraProfileFingerprint: 'u64:0000000000000002',
          decodePlanFingerprint: 'u64:0000000000000001',
          geometryFingerprint: 'u64:0000000000000004',
          implementationVersion: 1,
          sourceIdentity: `${browserHarnessRoot}/browser-harness.ARW`,
          sourceRevision: `source-revision-v1:${'0'.repeat(64)}`,
          whiteBalanceFingerprint: 'u64:0000000000000003',
        },
        baseGraphFingerprint: 'blake3:browser-harness-auto-edit-base',
        baseGraphRevision: request?.graphRevision ?? 'history_0',
        contract: 'rapidraw.auto_edit.v1',
        defaultEnabledGroups: ['light'],
        imageSessionId: request?.imageSessionId ?? 'browser-harness-image-session',
        impact: 1,
        implementationVersion: 1,
        proposalId: 'blake3:browser-harness-auto-edit-proposal',
        recommendations: [
          {
            confidence: 0.94,
            evidenceCodes: ['scene_midpoint_below_target'],
            expectedEffect: 'scene_light',
            group: 'light',
            proposedParameters: { exposure: 0.5 },
            safeToBatch: true,
            state: 'recommended',
            target: 'scene_global_color_tone',
          },
        ],
      });
    }
    case commandNames.applyAutoAdjustmentsToPaths: {
      const paths = getStringArrayArg(args, 'paths');
      const deferPath = getStringArg(args, 'deferPath');
      batchAutoAdjustInvocation += 1;
      const exposure = Number((0.6 + batchAutoAdjustInvocation * 0.05).toFixed(2));
      const results = paths.map((path, index) => {
        const current = harnessAdjustmentsByPath.get(path);
        const currentObject = typeof current === 'object' && current !== null ? current : {};
        return {
          contract: 'rapidraw.batch_auto_adjust.v1',
          path,
          receipt: {
            baseAdjustmentDocumentRevision: `sha256:${'a'.repeat(64)}`,
            adjustmentDocumentRevision: `sha256:${String(index + 1)
              .repeat(64)
              .slice(0, 64)}`,
            adjustments: {
              ...structuredClone(currentObject),
              contrast: 12,
              exposure,
              whiteBalanceTechnical: structuredClone(INITIAL_ADJUSTMENTS.whiteBalanceTechnical),
            },
            engine: 'rapidraw.auto_adjust.v1',
            renderFingerprint: `u64:${String(index + 1)
              .repeat(16)
              .slice(0, 16)}`,
            sourceIdentity: path,
            sourceRevision: `source-revision-v1:${String(index + 1)
              .repeat(64)
              .slice(0, 64)}`,
            thumbnailRevision: `browser-harness-auto-adjust-thumbnail-${String(index + 1)}`,
            transactionId: `blake3:browser-harness-batch-auto-adjust-${String(index + 1)}`,
          },
          status: path === deferPath ? 'prepared' : 'applied',
        };
      });
      return new Promise((resolve) => {
        window.setTimeout(
          () => resolve(results),
          window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.batchAutoAdjustPrepareDelayMs ?? 0,
        );
      });
    }
    case commandNames.commitBatchAutoAdjustment: {
      const request = args?.['request'] as { path?: string; receipt?: Record<string, unknown> } | undefined;
      const delayMs = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.batchAutoAdjustCommitDelayMs ?? 0;
      return new Promise((resolve) => {
        window.setTimeout(() => {
          if (request?.path && request.receipt?.['adjustments']) {
            harnessAdjustmentsByPath.set(request.path, structuredClone(request.receipt['adjustments']));
          }
          resolve({
            contract: 'rapidraw.batch_auto_adjust.v1',
            path: request?.path,
            receipt: {
              ...request?.receipt,
              adjustmentDocumentRevision: `sha256:${'b'.repeat(64)}`,
            },
            status: 'applied',
          });
        }, delayMs);
      });
    }
    case commandNames.previewAutoEditProposal: {
      const request = args?.['request'] as
        | {
            impact?: number;
            proposal?: { proposalId?: string };
            resultingGraphRevision?: string;
            selectedGroups?: string[];
          }
        | undefined;
      return Promise.resolve({
        adjustments: { exposure: 0.5 },
        graphRevision: request?.resultingGraphRevision ?? 'history_1',
        impact: request?.impact ?? 1,
        previewIdentity: 'blake3:browser-harness-auto-edit-preview',
        proposalId: request?.proposal?.proposalId ?? 'blake3:browser-harness-auto-edit-proposal',
        selectedGroups: request?.selectedGroups ?? ['light'],
        sourceRevision: `source-revision-v1:${'0'.repeat(64)}`,
      });
    }
    case commandNames.applyAutoEditProposal: {
      const request = args?.['request'] as
        | {
            expectedGraphRevision?: string;
            impact?: number;
            proposal?: { proposalId?: string };
            resultingGraphRevision?: string;
            selectedGroups?: string[];
          }
        | undefined;
      return Promise.resolve({
        adjustments: { exposure: 0.5 },
        receipt: {
          afterGraphFingerprint: 'blake3:browser-harness-auto-edit-after',
          appliedGroups: request?.selectedGroups ?? ['light'],
          baseGraphRevision: request?.expectedGraphRevision ?? 'history_0',
          beforeGraphFingerprint: 'blake3:browser-harness-auto-edit-before',
          contract: 'rapidraw.auto_edit.v1',
          historyTransactionId: 'blake3:browser-harness-auto-edit-transaction',
          impact: request?.impact ?? 1,
          implementationVersion: 1,
          parameterDiffs: [{ after: 0.5, before: 0, group: 'light', key: 'exposure' }],
          proposalId: request?.proposal?.proposalId ?? 'blake3:browser-harness-auto-edit-proposal',
          resultingGraphRevision: request?.resultingGraphRevision ?? 'history_1',
          skippedGroups: [],
          sourceRevision: `source-revision-v1:${'0'.repeat(64)}`,
        },
      });
    }
    case commandNames.cancelAutoEditAnalysis:
      return Promise.resolve(null);
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
    case commandNames.clearSessionCaches:
      return Promise.resolve(null);
    case commandNames.startBackgroundIndexing:
      catalogIndexingOperationId += 1;
      return Promise.resolve({ generation: catalogIndexingOperationId, operationId: catalogIndexingOperationId });
    case commandNames.cancelBackgroundIndexing:
      return Promise.resolve(true);
    case commandNames.updateThumbnailQueue:
      thumbnailOperationId += 1;
      return Promise.resolve({
        generation: Number((args?.['request'] as { generation?: unknown } | undefined)?.generation ?? 0),
        operationId: thumbnailOperationId,
      });
    case commandNames.cancelThumbnailGeneration:
      return Promise.resolve(true);
    case commandNames.applyAdjustmentsToPaths: {
      const adjustments = roundTripTauriJson(args?.['adjustments'] ?? null);
      const paths = getStringArrayArg(args, 'paths');
      for (const path of paths) harnessAdjustmentsByPath.set(path, structuredClone(adjustments));
      return new Promise((resolve) => {
        window.setTimeout(
          () =>
            resolve(
              paths.map((path) => ({
                adjustments,
                adjustmentRevision: null,
                catalogRevision: null,
                imageId: `path:${path}`,
                imageSessionId: null,
                path,
                renderFingerprint: 'u64:0000000000000001',
                sidecarRevision: `sha256:${'e'.repeat(64)}`,
                thumbnailRevision: 'f'.repeat(64),
                transactionId: null,
              })),
            ),
          window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyAdjustmentsToPathsDelayMs ?? 0,
        );
      });
    }
    case commandNames.saveMetadataAndUpdateThumbnail: {
      const path = getStringArg(args, 'path') ?? `${browserHarnessRoot}/browser-harness.ARW`;
      const response = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.metadataSaveResponses.shift();
      return new Promise((resolve, reject) => {
        window.setTimeout(() => {
          if (response?.failure !== undefined) {
            reject(new Error(response.failure));
            return;
          }
          if (args?.['adjustments']) harnessAdjustmentsByPath.set(path, structuredClone(args['adjustments']));
          resolve({
            adjustments: roundTripTauriJson(args?.['adjustments'] ?? null),
            adjustmentRevision:
              (args?.['transaction'] as { nextAdjustmentRevision?: unknown } | undefined)?.nextAdjustmentRevision ??
              null,
            catalogRevision: null,
            imageId: `path:${path}`,
            imageSessionId: (args?.['transaction'] as { imageSessionId?: unknown } | undefined)?.imageSessionId ?? null,
            path,
            renderFingerprint: 'u64:0000000000000001',
            sidecarRevision: response?.sidecarRevision ?? `sha256:${'a'.repeat(64)}`,
            thumbnailRevision: 'd'.repeat(64),
            transactionId: (args?.['transaction'] as { transactionId?: unknown } | undefined)?.transactionId ?? null,
          });
        }, response?.delayMs ?? 0);
      });
    }
    case commandNames.exportImages:
      dispatchBrowserHarnessEvent('export-complete', createHarnessExportReceipt(args));
      return Promise.resolve(null);
    case commandNames.importFiles: {
      const sourcePaths = getStringArrayArg(args, 'sourcePaths');
      const destinationFolder = getStringArg(args, 'destinationFolder') ?? browserHarnessRoot;
      const lifecycle = createBrowserHarnessImportLifecycle({
        destinationFolder,
        generation: 1,
        jobId: 'browser-harness-import-job',
        sourcePaths,
      });
      window.setTimeout(() => dispatchBrowserHarnessEvent('import-start', lifecycle.start), 0);
      sourcePaths.forEach((sourcePath, index) => {
        const importedPath = lifecycle.destinations[index];
        if (importedPath === undefined) return;
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
          () => dispatchBrowserHarnessEvent('import-progress', lifecycle.progress[index]),
          20 * (index + 1),
        );
      });
      folderRevision += sourcePaths.length;
      window.setTimeout(
        () => dispatchBrowserHarnessEvent('import-complete', lifecycle.terminal),
        20 * (sourcePaths.length + 1),
      );
      return Promise.resolve(lifecycle.authority);
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
      return Promise.resolve({ adjustments: harnessAdjustmentsByPath.get(getStringArg(args, 'path') ?? '') ?? null });
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
        metadata: { adjustments: harnessAdjustmentsByPath.get(request.path ?? '') ?? null, harness: true },
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
        }, window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.imageOpenDelayMs ?? 250);
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
    case commandNames.samplePointColorPicker: {
      const request = args?.['request'] as { graphRevision?: string; sourceIdentity?: string } | undefined;
      return new Promise((resolve) => {
        window.setTimeout(
          () =>
            resolve({
              chroma: 0.22,
              confidence: 0.94,
              graphFingerprint: 'browser-harness-graph-fingerprint',
              graphRevision: request?.graphRevision ?? 'browser-harness-graph',
              hueDegrees: 205,
              lightness: 0.43,
              sampleRadiusPx: 8,
              sourceFingerprint: 'browser-harness-source-fingerprint',
              sourceIdentity: request?.sourceIdentity ?? `${browserHarnessRoot}/browser-harness.ARW`,
            }),
          80,
        );
      });
    }
    case commandNames.sampleToneEqualizerPicker: {
      const request = args?.['request'] as { graphRevision?: string; sourceIdentity?: string } | undefined;
      return new Promise((resolve) => {
        window.setTimeout(
          () =>
            resolve({
              contributingWeights: [0, 0, 0.1, 0.3, 1, 0.3, 0.1, 0, 0],
              exposureEv: 0.25,
              graphFingerprint: '1234567890abcdef',
              graphRevision: request?.graphRevision ?? 'browser-harness-graph',
              primaryBand: 4,
              sourceFingerprint: 'abcdef1234567890',
              sourceIdentity: request?.sourceIdentity ?? `${browserHarnessRoot}/browser-harness.ARW`,
            }),
          80,
        );
      });
    }
    case commandNames.sampleViewerPixel: {
      const request = args?.['request'] as
        | {
            normalizedImagePoint?: { x?: number; y?: number };
            requestIdentity?: string;
            sourceImageSize?: { height?: number; width?: number };
          }
        | undefined;
      const injected = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.viewerSampleResponses.shift();
      const delayMs = injected?.delayMs ?? 20;
      return new Promise((resolve) => {
        window.setTimeout(() => {
          const requestIdentity = request?.requestIdentity ?? 'browser-harness-viewer-sample';
          if (injected?.status === 'unavailable') {
            resolve({
              reason: 'frameUnavailable',
              requestIdentity,
              spaceLabel: 'Unavailable',
              status: 'unavailable',
            });
            return;
          }
          const normalizedX = request?.normalizedImagePoint?.x ?? 0.5;
          const normalizedY = request?.normalizedImagePoint?.y ?? 0.5;
          const width = request?.sourceImageSize?.width ?? 1600;
          const height = request?.sourceImageSize?.height ?? 1200;
          const rgb = injected?.rgb ?? [normalizedX, normalizedY, 0.25];
          resolve({
            clippedChannels: [],
            imagePointPx: {
              x: Math.max(0, Math.round(normalizedX * Math.max(0, width - 1))),
              y: Math.max(0, Math.round(normalizedY * Math.max(0, height - 1))),
            },
            luma: rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722,
            requestIdentity,
            rgb,
            spaceLabel: 'Display encoded browser harness',
            status: 'available',
          });
        }, delayMs);
      });
    }
    case commandNames.configureLibraryChangefeed:
      return Promise.resolve(1);
    case commandNames.generateOriginalTransformedPreview: {
      const response = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.originalPreviewResponses.shift();
      if (response === undefined) return Promise.resolve(`data:image/jpeg;base64,${harnessPreviewJpegBase64}`);
      return new Promise((resolve) => window.setTimeout(() => resolve(response.url), response.delayMs));
    }
    case commandNames.generateMaskOverlay:
      return Promise.resolve(`data:image/jpeg;base64,${harnessPreviewJpegBase64}`);
    case commandNames.generateAiSubjectMask: {
      const response = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.aiSubjectMaskResponses.shift() ?? {
        delayMs: 0,
        value: {
          generatedMaskArtifactId: 'browser-harness-ai-subject-mask',
          generatedMaskCoverage: 0.42,
        },
      };
      return new Promise((resolve) =>
        window.setTimeout(() => resolve(structuredClone(response.value)), response.delayMs),
      );
    }
    case commandNames.invokeGenerativeReplaceWithMaskDef:
      return Promise.resolve(JSON.stringify({ browserHarnessQuickErase: true }));
    case commandNames.precomputeAiSubjectMask:
      return Promise.resolve(null);
    case commandNames.generateUncroppedPreview:
      window.setTimeout(() => {
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.emitEvent(
          'preview-update-uncropped',
          `data:image/jpeg;base64,${harnessPreviewJpegBase64}`,
        );
      }, 0);
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
      return Promise.resolve(null);
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
    case commandNames.getLensfunLensesForMaker:
      return Promise.resolve(['35mm Prime', 'Slow Prime', 'Fast Prime']);
    case commandNames.getLensDistortionParams: {
      const response = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.lensDistortionResponses.shift();
      if (response === undefined) return Promise.resolve(null);
      return new Promise((resolve) => window.setTimeout(() => resolve(response.value), response.delayMs));
    }
    case commandNames.autodetectLens:
      return Promise.resolve(null);
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
  computeWaveform: boolean;
  expectedImagePath: string;
  isInteractive: boolean;
  previewOperationIdentity: PreviewOperationIdentity;
  roi: [number, number, number, number] | null;
  targetResolution: number;
}

const normalizeHarnessApplyPreviewRequest = (args: Record<string, unknown> | undefined): HarnessApplyPreviewRequest => {
  const candidate = args?.['request'];
  const request = typeof candidate === 'object' && candidate !== null ? (candidate as Record<string, unknown>) : {};
  editDocumentV2Schema.parse(request['editDocumentV2']);
  if ('jsAdjustments' in request) throw new Error('Preview request used the retired flat adjustments payload.');
  const roiCandidate = request['roi'];
  const roi =
    Array.isArray(roiCandidate) &&
    roiCandidate.length === 4 &&
    roiCandidate.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
      ? ([roiCandidate[0], roiCandidate[1], roiCandidate[2], roiCandidate[3]] as [number, number, number, number])
      : null;
  const requestedResolution = request['targetResolution'];
  return {
    computeWaveform: request['computeWaveform'] === true,
    expectedImagePath:
      typeof request['expectedImagePath'] === 'string'
        ? request['expectedImagePath']
        : `${browserHarnessRoot}/browser-harness.ARW`,
    isInteractive: request['isInteractive'] === true,
    previewOperationIdentity: previewOperationIdentitySchema.parse(request['previewOperationIdentity']),
    roi,
    targetResolution:
      typeof requestedResolution === 'number' && Number.isFinite(requestedResolution)
        ? Math.min(4096, Math.max(1, Math.round(requestedResolution)))
        : 1024,
  };
};

const emitHarnessPreviewAnalytics = (request: HarnessApplyPreviewRequest): void => {
  const resource = (kind: string) => ({
    byteLen: 256,
    mimeType: 'application/x-rapidraw-rgba8',
    resourceId: kind === 'luma' ? 'a'.repeat(64) : 'b'.repeat(64),
    url: `/__browser-harness-analytics/${kind}`,
  });
  dispatchBrowserHarnessEvent('analytics-result', {
    frameId: {
      graphRevision: request.previewOperationIdentity.operationId,
      imageSession: request.previewOperationIdentity.session.imageSessionId,
      previewGeneration: request.previewOperationIdentity.generation,
    },
    gamut: null,
    histogram: {
      blue: [0.1, 0.2, 0.3],
      green: [0.2, 0.3, 0.4],
      luma: [0.3, 0.4, 0.5],
      red: [0.4, 0.5, 0.6],
    },
    path: request.expectedImagePath,
    previewOperationIdentity: request.previewOperationIdentity,
    requestedProducts: request.computeWaveform ? 31 : 1,
    scopes: request.computeWaveform
      ? {
          height: 256,
          luma: resource('luma'),
          parade: resource('parade'),
          rgb: resource('rgb'),
          vectorscope: resource('vectorscope'),
          width: 256,
        }
      : null,
    spatial: {
      gridHeight: 1,
      gridWidth: 1,
      tiles: [
        {
          blueMean: 0.3,
          clippedFraction: 0,
          greenMean: 0.4,
          lumaMean: 0.5,
          lumaSpread: 0.1,
          redMean: 0.6,
          sampleCount: 64,
          x: 0,
          y: 0,
        },
      ],
    },
    timing: { finishingMs: 0.2, fullImageConversions: 0, samplingMs: 0.5, sourcePixelsRead: 64 },
  });
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
  if (request.roi === null) emitHarnessPreviewAnalytics(request);
  const injected = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyPreviewResponses.shift();
  if (injected !== undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Browser harness could not create injected preview canvas context.');
    context.fillStyle = `rgb(${injected.color.map(String).join(',')})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value === null ? reject(new Error('Browser harness JPEG encode failed.')) : resolve(value)),
        'image/jpeg',
        0.95,
      );
    });
    await new Promise((resolve) => window.setTimeout(resolve, injected.delayMs));
    return blob.arrayBuffer();
  }
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
