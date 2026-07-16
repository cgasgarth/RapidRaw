export type BrowserTauriInvoke = (
  command: string,
  args?: Record<string, unknown>,
  options?: unknown,
) => Promise<unknown>;

export type BrowserTauriEventCallback = (event: unknown) => void;

export interface BrowserTauriInternals {
  convertFileSrc: (filePath: string, protocol?: string) => string;
  invoke: BrowserTauriInvoke;
  transformCallback: (callback: unknown, once?: boolean) => number;
  unregisterCallback: (id: number) => void;
}

export interface BrowserTauriInvokeCall {
  args?: Record<string, unknown> | undefined;
  command: string;
  endedAtMs: number | null;
  options?: unknown;
  startedAtMs: number;
}

export interface BrowserHarnessImage {
  exif: null;
  is_edited: boolean;
  is_virtual_copy: boolean;
  modified: number;
  path: string;
  rating: number;
  tags: null;
}

export interface BrowserHarnessOriginalPreviewResponse {
  delayMs: number;
  url: string;
}

export interface BrowserHarnessApplyPreviewResponse {
  color: [number, number, number];
  delayMs: number;
}

export interface BrowserHarnessMetadataSaveResponse {
  delayMs: number;
  failure?: string;
  sidecarRevision?: string;
}

export interface BrowserHarnessInvokeResponse {
  delayMs: number;
  value: unknown;
}

export interface BrowserHarnessAutoAdjustResponse {
  delayMs: number;
  failure?: string;
  value?: unknown;
}

export interface BrowserHarnessTonePlacementResponse {
  delayMs: number;
  failure?: string;
  value: unknown;
}

export interface BrowserHarnessViewerSampleResponse {
  delayMs: number;
  rgb?: [number, number, number];
  status?: 'available' | 'unavailable';
}

declare global {
  interface Window {
    __RAWENGINE_BROWSER_TAURI_HARNESS__?: {
      calls: Array<BrowserTauriInvokeCall>;
      enabled: boolean;
      emitEvent: (event: string, payload: unknown) => void;
      failNextSettingsSave: boolean;
      applyAdjustmentsToPathsDelayMs: number;
      autoAdjustResponses: Array<BrowserHarnessAutoAdjustResponse>;
      applyPreviewResponses: Array<BrowserHarnessApplyPreviewResponse>;
      originalPreviewResponses: Array<BrowserHarnessOriginalPreviewResponse>;
      resetAdjustmentsResponses: Array<BrowserHarnessInvokeResponse>;
      revokedObjectUrls: Array<string>;
      batchAutoAdjustCommitDelayMs: number;
      batchAutoAdjustPrepareDelayMs: number;
      imageOpenDelayMs: number;
      lensDistortionResponses: Array<BrowserHarnessInvokeResponse>;
      aiSubjectMaskResponses: Array<BrowserHarnessInvokeResponse>;
      metadataSaveResponses: Array<BrowserHarnessMetadataSaveResponse>;
      perspectiveAnalysisResponses: Array<BrowserHarnessInvokeResponse>;
      tonePlacementResponses: Array<BrowserHarnessTonePlacementResponse>;
      viewerSampleResponses: Array<BrowserHarnessViewerSampleResponse>;
      setAdjustmentsForPath: (path: string, adjustments: unknown) => void;
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
