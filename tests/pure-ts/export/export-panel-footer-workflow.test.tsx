import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import ExportPanel from '../../../src/components/panel/right/export/ExportPanel.tsx';
import { type AppSettings, type SelectedImage, Theme } from '../../../src/components/ui/AppProperties.tsx';
import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  type ExportState,
  Status,
} from '../../../src/components/ui/ExportImportProperties.ts';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { EXPORT_LAST_USED_PRESET_ID } from '../../../src/schemas/export/exportRecipeIds.ts';
import { parseExportReceiptPayload } from '../../../src/schemas/tauriEventSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useProcessStore } from '../../../src/store/useProcessStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const imagePath = '/validation/export-footer-workflow.ARW';
const proofPreset: ExportPreset = {
  blackPointCompensation: false,
  colorProfile: ExportColorProfile.Srgb,
  dontEnlarge: true,
  enableResize: false,
  enableWatermark: false,
  fileFormat: 'jpeg',
  filenameTemplate: '{original_filename}_edited',
  id: 'export-footer-srgb-proof',
  jpegQuality: 90,
  keepMetadata: true,
  name: 'sRGB export proof',
  preserveTimestamps: false,
  renderingIntent: ExportRenderingIntent.RelativeColorimetric,
  resizeMode: 'longEdge',
  resizeValue: 2048,
  stripGps: true,
  watermarkAnchor: 'bottomRight',
  watermarkOpacity: 75,
  watermarkPath: null,
  watermarkScale: 10,
  watermarkSpacing: 5,
};
const appSettings: AppSettings = {
  exportPresets: [proofPreset],
  lastRootPath: null,
  theme: Theme.Dark,
};
const displayP3LastUsedPreset: ExportPreset = {
  ...proofPreset,
  colorProfile: ExportColorProfile.DisplayP3,
  id: EXPORT_LAST_USED_PRESET_ID,
  name: 'Last used Display P3 export',
};
const warningAppSettings: AppSettings = {
  exportPresets: [displayP3LastUsedPreset],
  lastRootPath: null,
  theme: Theme.Dark,
};
const selectedImage: SelectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: imagePath,
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 4000,
};
const consistentProofTransform = {
  blackPointCompensation: 'disabled',
  colorManagedTransform: 'sRGB preview transform',
  effectiveColorProfile: 'sRGB',
  effectiveRenderingIntent: 'Relative colorimetric',
  policyStatus: 'applied',
  policyVersion: 'export-footer-workflow-test',
  sourcePrecisionPath: 'raw-linear-f32',
  transformApplied: true,
  transformPolicyFingerprint: 'sha256:export-footer-workflow-test',
};
const completedReceipt = parseExportReceiptPayload({
  completedAt: '2026-07-10T12:00:00.000Z',
  outputs: [
    {
      bitDepth: 16,
      byteSize: 2_048,
      colorManagedTransform: 'display-p3-output',
      colorProfile: 'Display P3',
      effectiveColorProfile: ExportColorProfile.DisplayP3,
      effectiveRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
      format: 'tiff',
      iccEmbedded: true,
      outputPath: '/tmp/export-footer-workflow.tif',
      outputDigest: {
        algorithm: 'sha256',
        byteLen: 2_048,
        provenance: 'finalByteAtomicWriter',
        value: `sha256:${'c'.repeat(64)}`,
      },
      policyStatus: 'applied',
      policyVersion: 'export-footer-workflow-test',
      renderingIntent: 'Relative colorimetric',
      requestedColorProfile: ExportColorProfile.DisplayP3,
      requestedRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
      sourcePath: imagePath,
      transformApplied: true,
      transformPolicyFingerprint: 'sha256:export-footer-workflow-receipt',
    },
  ],
  terminalStatus: 'completed',
  total: 1,
});

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  resetEditorState();
});

describe('export panel compact footer workflow', () => {
  test('keeps a ready export summary compact while proof settings are consistent', async () => {
    setProofState(true);
    const { container } = await renderFooter({
      errorMessage: '',
      progress: { current: 0, total: 0 },
      status: Status.Idle,
    });

    const workflow = required<HTMLElement>(container, '[data-testid="export-footer-workflow-state"]');
    expect(workflow.dataset.exportFooterWorkflowState).toBe('idle');
    expect(workflow.querySelector('[data-testid="export-readiness-summary"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-proof-footer-proof-state"]')).toBeNull();
    expect(primaryAction(container).textContent).toContain('Export Image');
  });

  test('keeps proof warnings collapsed while preserving resolver and warning details', async () => {
    setProofState(false);
    const { container } = await renderFooter(
      { errorMessage: '', progress: { current: 0, total: 0 }, status: Status.Idle },
      { appSettings: warningAppSettings, isVisible: true },
    );

    const proofDetails = required<HTMLDetailsElement>(container, '[data-testid="export-proof-footer-proof-state"]');
    expect(proofDetails.open).toBe(false);
    expect(
      required<HTMLElement>(container, '[data-testid="export-soft-proof-warnings"]').dataset
        .exportSoftProofWarningCount,
    ).toBe('1');
    expect(container.querySelector('[data-testid="export-soft-proof-resolver"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-soft-proof-resolver-preview-export"]')).not.toBeNull();
  });

  test('keeps the cancel action dominant while export is in progress', async () => {
    setProofState(true);
    const { container } = await renderFooter({
      errorMessage: '',
      progress: { current: 1, total: 3 },
      status: Status.Exporting,
    });

    const workflow = required<HTMLElement>(container, '[data-testid="export-footer-workflow-state"]');
    const action = primaryAction(container);
    expect(workflow.dataset.exportFooterWorkflowState).toBe('running');
    expect(action.getAttribute('aria-busy')).toBe('true');
    expect(action.textContent).toContain('Cancel export');
  });

  test('presents failed and cancelled exports as retry states without dropping status detail', async () => {
    setProofState(true);
    const { container } = await renderFooter({
      errorMessage: 'Output folder became unavailable.',
      progress: { current: 0, total: 1 },
      status: Status.Error,
    });

    expect(
      required<HTMLElement>(container, '[data-testid="export-footer-workflow-state"]').dataset
        .exportFooterWorkflowState,
    ).toBe('failed');
    expect(required<HTMLDetailsElement>(container, '[data-testid="export-error-alert"]').open).toBe(false);
    expect(primaryAction(container).textContent).toContain('Retry Export');

    await rerenderFooter({ errorMessage: '', progress: { current: 0, total: 1 }, status: Status.Cancelled });
    expect(
      required<HTMLElement>(container, '[data-testid="export-footer-workflow-state"]').dataset
        .exportFooterWorkflowState,
    ).toBe('canceled');
    expect(primaryAction(container).textContent).toContain('Retry Export');
  });

  test('keeps completed receipt and linked-variant actions available from the disclosure', async () => {
    setProofState(true);
    const { container } = await renderFooter({
      errorMessage: '',
      lastReceipt: completedReceipt,
      progress: { current: 1, total: 1 },
      status: Status.Success,
    });

    const workflow = required<HTMLElement>(container, '[data-testid="export-footer-workflow-state"]');
    expect(workflow.dataset.exportFooterWorkflowState).toBe('completed');
    expect(workflow.dataset.exportFooterCanOpen).toBe('true');
    expect(workflow.dataset.exportFooterCanImportLinkedVariant).toBe('true');
    expect(container.querySelector('[data-testid="export-success-receipt"]')).not.toBeNull();
    expect(completedReceipt.outputs[0]?.outputDigest?.provenance).toBe('finalByteAtomicWriter');
    expect(container.querySelector('[data-testid="export-success-import-linked-variant"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-success-open-in-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="export-success-show-in-finder"]')).not.toBeNull();
    expect(primaryAction(container).textContent).toContain('Export Again');
  });
});

async function renderFooter(
  exportState: ExportState,
  options: { appSettings?: AppSettings; isVisible?: boolean } = {},
) {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  renderedRoot = { container, root };
  await rerenderFooter(exportState, options);
  return { container, root };
}

async function rerenderFooter(
  exportState: ExportState,
  {
    appSettings: currentAppSettings = appSettings,
    isVisible = false,
  }: { appSettings?: AppSettings; isVisible?: boolean } = {},
) {
  if (renderedRoot === null) throw new Error('Expected export footer root.');
  const i18n = await createTestI18n();

  await act(async () => {
    renderedRoot?.root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          ContextMenuProvider,
          null,
          createElement(ExportPanel, {
            appSettings: currentAppSettings,
            exportState,
            isVisible,
            multiSelectedPaths: [imagePath],
            onLinkedVariantImported: () => {},
            onSettingsChange: () => {},
            rootPaths: [],
            selectedImage,
            setExportState: () => {},
          }),
        ),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setProofState(isConsistent: boolean) {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    exportSoftProofRecipeId: isConsistent ? proofPreset.id : null,
    exportSoftProofTransform: isConsistent ? consistentProofTransform : null,
    gamutWarningOverlay: null,
    isExportSoftProofEnabled: isConsistent,
    isGamutWarningOverlayVisible: false,
    selectedImage,
  });
  useProcessStore.setState({ thumbnailSmartPreviews: {} });
}

function resetEditorState() {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    exportSoftProofRecipeId: null,
    exportSoftProofTransform: null,
    gamutWarningOverlay: null,
    isExportSoftProofEnabled: false,
    isGamutWarningOverlayVisible: false,
    selectedImage: null,
  });
  useProcessStore.setState({ thumbnailSmartPreviews: {} });
}

function primaryAction(container: HTMLElement): HTMLButtonElement {
  const action = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.className.includes('h-10 w-full'),
  );
  if (action === undefined) throw new Error('Expected primary export action.');
  return action;
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

function installDom() {
  if (globalThis.window) return;
  const window = new Window({ url: 'http://localhost/export-panel-footer-workflow' });
  Object.assign(globalThis, {
    document: window.document,
    HTMLDetailsElement: window.HTMLDetailsElement,
    HTMLDivElement: window.HTMLDivElement,
    HTMLElement: window.HTMLElement,
    navigator: window.navigator,
    window,
  });
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  return instance;
}
