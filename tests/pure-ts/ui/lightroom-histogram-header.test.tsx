import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import type { ChannelConfig } from '../../../src/components/adjustments/Curves';
import {
  formatClipPercent,
  getHistogramClippingSummary,
  sampleHistogram,
} from '../../../src/components/panel/editor/Waveform';
import InspectorAnalyticsHeader, {
  formatDevelopPhotoMetadata,
  resolveHistogramHeaderState,
} from '../../../src/components/panel/right/inspector/InspectorAnalyticsHeader';
import { Theme } from '../../../src/components/ui/AppProperties';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { ActiveChannel, DisplayMode } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const path = '/private/alaska/_DSC8786.ARW';

describe('Lightroom-class compact histogram header', () => {
  beforeEach(() => {
    Reflect.set(window, '__TAURI_INTERNALS__', { invoke: () => Promise.resolve(null) });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeWaveformChannel: DisplayMode.Luma,
      editDocumentV2: createDefaultEditDocumentV2(),
      histogram: histogram(),
      isWaveformVisible: false,
      showClipping: false,
      panelScopesLayout: 'stacked',
      previewScopeRecoveryError: null,
      previewScopeRecoveryRequestId: 0,
      previewScopeRecoveryState: 'idle',
      previewScopeStatus: currentScope(path),
      selectedImage: selected(path),
      waveform: null,
    });
    useSettingsStore.getState().setAppSettings({
      activeWaveformChannel: DisplayMode.Luma,
      lastRootPath: null,
      panelScopesLayout: 'stacked',
      theme: Theme.Dark,
      waveformHeight: 192,
    });
  });

  afterEach(() => cleanup());

  test('renders one real RGB+luma histogram, compact EXIF, and a reserved tool mount before controls', async () => {
    const { container } = await renderHeader();
    const header = required(container, '[data-testid="histogram-under-test"]');
    const plot = required(container, '[data-testid="histogram-under-test-histogram"]');

    expect(header.getAttribute('data-analytics-state')).toBe('current');
    expect(header.getAttribute('data-state')).toBe('histogram');
    expect(plot.getAttribute('data-histogram-bin-count')).toBe('256');
    expect(plot.querySelectorAll('svg g')).toHaveLength(4);
    expect(required(container, '[data-testid="histogram-under-test-metadata"]').textContent).toContain('SONY ILCE-1');
    expect(required(container, '[data-testid="histogram-under-test-metadata"]').textContent).toContain(
      '35 mm · 1/250 s · f/2.8 · ISO 100',
    );
    expect(required(container, '[data-testid="histogram-under-test-tool-strip-mount"]').childElementCount).toBe(0);
    expect(container.querySelector('[data-testid="histogram-under-test-mode-luma"]')).toBeNull();
    expect(container.textContent).not.toContain('preview_scope_current');
    expect(container.querySelector('[data-testid="histogram-loading-surface"]')).toBeNull();
  });

  test('publishes channel and tonal-zone readouts through pointer and keyboard without mutating edits', async () => {
    const { container } = await renderHeader();
    const plot = required<HTMLElement>(container, '[data-testid="histogram-under-test-histogram"]');
    Object.defineProperty(plot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 128, height: 128, left: 0, right: 256, top: 0, width: 256, x: 0, y: 0 }),
    });
    const revision = useEditorStore.getState().adjustmentRevision;

    fireEvent.pointerMove(plot, { clientX: 130, clientY: 40 });
    const pointerReadout = required(container, '[data-testid="histogram-under-test-hover-readout"]');
    expect(pointerReadout.getAttribute('data-histogram-zone')).toBe('exposure');
    expect(pointerReadout.textContent).toMatch(/R \d+% G \d+% B \d+% L \d+%/u);

    plot.focus();
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(
      required(container, '[data-testid="histogram-under-test-hover-readout"]').getAttribute('data-histogram-zone'),
    ).toBe('blacks');
    fireEvent.keyDown(plot, { key: 'End' });
    expect(
      required(container, '[data-testid="histogram-under-test-hover-readout"]').getAttribute('data-histogram-zone'),
    ).toBe('whites');
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(container.querySelector('[data-testid="histogram-under-test-hover-readout"]')).toBeNull();
    expect(useEditorStore.getState().adjustmentRevision).toBe(revision);
  });

  test('toggles clipping with pointer and keyboard as non-destructive view state and exposes non-color labels', async () => {
    const user = userEvent.setup();
    const { container } = await renderHeader();
    const shadow = required<HTMLButtonElement>(
      container,
      '[data-testid="histogram-under-test-shadow-clipping-toggle"]',
    );
    const highlight = required<HTMLButtonElement>(
      container,
      '[data-testid="histogram-under-test-highlight-clipping-toggle"]',
    );
    const initialHistoryIndex = useEditorStore.getState().historyIndex;
    const initialRevision = useEditorStore.getState().adjustmentRevision;

    expect(shadow.textContent).toBe('S');
    expect(highlight.textContent).toBe('H');
    expect(shadow.getAttribute('data-clipped')).toBe('true');
    expect(highlight.getAttribute('data-clipped')).toBe('true');
    expect(shadow.getAttribute('aria-pressed')).toBe('false');

    await user.click(shadow);
    expect(useEditorStore.getState().showClipping).toBe(true);
    expect(useEditorStore.getState().historyIndex).toBe(initialHistoryIndex);
    expect(useEditorStore.getState().adjustmentRevision).toBe(initialRevision);
    expect(shadow.getAttribute('aria-pressed')).toBe('true');

    await user.click(highlight);
    expect(useEditorStore.getState().showClipping).toBe(false);
    shadow.focus();
    await user.keyboard(' ');
    expect(useEditorStore.getState().showClipping).toBe(true);
  });

  test('rejects stale histogram pixels and clipping, then requests a current retry', async () => {
    const user = userEvent.setup();
    act(() => useEditorStore.getState().setEditor({ previewScopeStatus: currentScope('/private/alaska/other.ARW') }));
    const { container } = await renderHeader();
    const header = required(container, '[data-testid="histogram-under-test"]');

    expect(header.getAttribute('data-analytics-state')).toBe('degraded');
    expect(container.querySelector('[data-testid="histogram-under-test-histogram"]')).toBeNull();
    expect(
      required<HTMLButtonElement>(container, '[data-testid="histogram-under-test-shadow-clipping-toggle"]').disabled,
    ).toBe(true);
    expect(required(container, '[data-testid="histogram-under-test-state"]').textContent).toContain(
      'Updating histogram for this photo',
    );

    await user.click(required<HTMLButtonElement>(container, '[data-testid="histogram-under-test-recover-scopes"]'));
    expect(useEditorStore.getState().previewScopeRecoveryRequestId).toBe(1);
    expect(useEditorStore.getState().previewScopeRecoveryState).toBe('loading');
    expect(header.getAttribute('data-analytics-state')).toBe('loading');
  });

  test('uses bounded empty, loading, unsupported, and actionable error states without fabricated data', async () => {
    const { container, rerender } = await renderHeader();
    const renderCurrent = () =>
      createElement(
        I18nextProvider,
        { i18n: testI18n },
        createElement(InspectorAnalyticsHeader, { testId: 'histogram-under-test' }),
      );

    act(() => useEditorStore.getState().setEditor({ selectedImage: null }));
    rerender(renderCurrent());
    expect(required(container, '[data-testid="histogram-under-test"]').getAttribute('data-analytics-state')).toBe(
      'empty',
    );

    act(() => useEditorStore.getState().setEditor({ selectedImage: selected(path, false), previewScopeStatus: null }));
    rerender(renderCurrent());
    expect(required(container, '[data-testid="histogram-under-test"]').getAttribute('data-analytics-state')).toBe(
      'loading',
    );

    act(() =>
      useEditorStore.getState().setEditor({
        selectedImage: selected(path),
        previewScopeStatus: { ...currentScope(path), renderBasis: 'export_preview', softProofTransformApplied: false },
      }),
    );
    rerender(renderCurrent());
    expect(required(container, '[data-testid="histogram-under-test"]').getAttribute('data-analytics-state')).toBe(
      'unavailable',
    );

    act(() =>
      useEditorStore.getState().setEditor({
        previewScopeRecoveryError: 'native analytics timeout internals',
        previewScopeRecoveryState: 'error',
      }),
    );
    rerender(renderCurrent());
    expect(required(container, '[data-testid="histogram-under-test"]').getAttribute('data-analytics-state')).toBe(
      'error',
    );
    expect(container.textContent).toContain('Histogram could not be loaded');
    expect(container.textContent).not.toContain('native analytics timeout internals');
    expect(container.querySelector('[data-testid="histogram-under-test-histogram"]')).toBeNull();
  });

  test('keeps all advanced modes, proof diagnostics, resizing, and roving keyboard focus secondary', async () => {
    const user = userEvent.setup();
    const { container } = await renderHeader();
    const toggle = required<HTMLButtonElement>(container, '[data-testid="histogram-under-test-expand-toggle"]');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(required(container, '[data-testid="histogram-under-test"]').getAttribute('data-state')).toBe(
      'advanced-open',
    );
    expect(container.querySelectorAll('[data-scope-mode]')).toHaveLength(5);
    expect(container.querySelector('[data-testid="histogram-under-test-proof-status"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="histogram-under-test-resizer"]')).not.toBeNull();

    const parade = required<HTMLButtonElement>(container, '[data-testid="histogram-under-test-mode-parade"]');
    await user.click(parade);
    expect(useEditorStore.getState().activeWaveformChannel).toBe(DisplayMode.Parade);
    await user.keyboard('{ArrowRight}');
    expect(useEditorStore.getState().activeWaveformChannel).toBe(DisplayMode.Vectorscope);
    expect(document.activeElement).toBe(required(container, '[data-testid="histogram-under-test-mode-vectorscope"]'));
  });

  test('keeps a current histogram visible while optional advanced scopes are unavailable', async () => {
    act(() =>
      useEditorStore.getState().setEditor({
        previewScopeRecoveryError: 'Analytics completed without all current preview scopes.',
        previewScopeRecoveryState: 'error',
        previewScopeStatus: {
          ...currentScope(path),
          warningCodes: ['preview_scope_error:incomplete_advanced_scopes_receipt'],
          waveformReady: false,
        },
      }),
    );
    const { container } = await renderHeader();
    expect(required(container, '[data-testid="histogram-under-test"]').getAttribute('data-analytics-state')).toBe(
      'current',
    );
    expect(container.querySelector('[data-testid="histogram-under-test-histogram"]')).not.toBeNull();
  });
});

test('histogram math uses real bins for clipping and channel-aware zones', () => {
  const data = histogram();
  expect(getHistogramClippingSummary(data)).toEqual({ highlightPercent: 20, shadowPercent: 10 });
  expect(formatClipPercent(0.04)).toBe('<0.1%');
  expect(sampleHistogram(data, -50)?.zone).toBe('blacks');
  expect(sampleHistogram(data, 128)).toMatchObject({ bin: 128, zone: 'exposure' });
  expect(sampleHistogram(data, 999)?.zone).toBe('whites');
  expect(sampleHistogram(null, 10)).toBeNull();
});

test('EXIF formatting is concise, deterministic, and gracefully partial', () => {
  expect(
    formatDevelopPhotoMetadata({
      ExposureTime: '0.004',
      FNumber: '28/10',
      FocalLengthIn35mmFilm: '35',
      ISO: '100',
      Make: 'SONY',
      Model: 'ILCE-1',
    }),
  ).toEqual({ camera: 'SONY ILCE-1', settings: '35 mm · 1/250 s · f/2.8 · ISO 100' });
  expect(formatDevelopPhotoMetadata({ Model: 'SONY ILCE-1' })).toEqual({ camera: 'SONY ILCE-1', settings: null });
  expect(formatDevelopPhotoMetadata(null)).toEqual({ camera: null, settings: null });
});

test('histogram state policy keeps optional advanced scopes independent', () => {
  const current = {
    hasImage: true,
    histogramFreshness: 'current' as const,
    imageReady: true,
    recoveryState: 'idle' as const,
    scopeStatusPresent: true,
  };
  expect(resolveHistogramHeaderState(current)).toBe('current');
  expect(resolveHistogramHeaderState({ ...current, recoveryState: 'error' })).toBe('current');
  expect(resolveHistogramHeaderState({ ...current, histogramFreshness: 'stale' })).toBe('degraded');
  expect(resolveHistogramHeaderState({ ...current, histogramFreshness: 'unsupported' })).toBe('unavailable');
  expect(resolveHistogramHeaderState({ ...current, histogramFreshness: 'error' })).toBe('error');
  expect(resolveHistogramHeaderState({ ...current, scopeStatusPresent: false })).toBe('loading');
  expect(resolveHistogramHeaderState({ ...current, hasImage: false })).toBe('empty');
});

const testI18n = i18next.createInstance();
await testI18n.use(initReactI18next).init({
  defaultNS: 'translation',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

async function renderHeader() {
  return render(
    createElement(
      I18nextProvider,
      { i18n: testI18n },
      createElement(InspectorAnalyticsHeader, { testId: 'histogram-under-test' }),
    ),
  );
}

function required<T extends Element = Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

function selected(imagePath: string, isReady = true) {
  return {
    exif: {
      ExposureTime: '0.004',
      FNumber: '28/10',
      FocalLengthIn35mmFilm: '35',
      ISO: '100',
      Make: 'SONY',
      Model: 'ILCE-1',
    },
    height: 4000,
    isRaw: true,
    isReady,
    metadata: null,
    originalUrl: null,
    path: imagePath,
    rawDevelopmentReport: null,
    thumbnailUrl: 'data:image/jpeg;base64,AAAA',
    width: 6000,
  };
}

function currentScope(imagePath: string) {
  return {
    displayTransformLabel: 'Display P3',
    exportProfileLabel: null,
    exportRenderingIntentLabel: null,
    histogramReady: true,
    path: imagePath,
    renderBasis: 'editor_preview' as const,
    softProofTransformApplied: false,
    sourceLabel: 'Edited preview',
    updatedAt: '2026-07-16T15:00:00.000Z',
    waveformReady: true,
    workingTransformLabel: 'Working RGB',
    warningCodes: [],
  };
}

function histogram(): ChannelConfig {
  const channel = (shadow: number, middle: number, highlight: number) => {
    const bins = Array.from({ length: 256 }, () => 0);
    bins[0] = shadow;
    bins[128] = middle;
    bins[255] = highlight;
    return bins;
  };
  return {
    [ActiveChannel.Blue]: { color: '#5c91ff', data: channel(10, 70, 20) },
    [ActiveChannel.Green]: { color: '#66d17a', data: channel(5, 90, 5) },
    [ActiveChannel.Luma]: { color: '#d8dde5', data: channel(2, 96, 2) },
    [ActiveChannel.Red]: { color: '#ff625f', data: channel(1, 99, 0) },
  };
}
