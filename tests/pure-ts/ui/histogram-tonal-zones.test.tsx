import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import type { ChannelConfig } from '../../../src/components/adjustments/Curves';
import {
  getHistogramTonalZoneConfig,
  HISTOGRAM_TONAL_ZONES,
  type HistogramTonalZone,
  type HistogramTonalZoneEditor,
  HistogramView,
} from '../../../src/components/panel/editor/Waveform';
import InspectorAnalyticsHeader from '../../../src/components/panel/right/inspector/InspectorAnalyticsHeader';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, BasicAdjustment } from '../../../src/utils/adjustments';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const testI18n = i18next.createInstance();
await testI18n.use(initReactI18next).init({
  defaultNS: 'translation',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

describe('direct histogram tonal-zone editing', () => {
  afterEach(() => cleanup());

  test('publishes the Lightroom tonal mapping and bounded ranges', () => {
    expect(HISTOGRAM_TONAL_ZONES.map(({ key }) => key)).toEqual([
      'blacks',
      'shadows',
      'exposure',
      'highlights',
      'whites',
    ]);
    expect(getHistogramTonalZoneConfig('exposure')).toMatchObject({ min: -5, max: 5, step: 0.01 });
    expect(getHistogramTonalZoneConfig('whites').adjustment).toBe(BasicAdjustment.Whites);
  });

  test('runs one pointer drag through start, preview, and commit', () => {
    const events: string[] = [];
    let values = { exposure: 0 };
    const editor: HistogramTonalZoneEditor = {
      enabled: true,
      values: { exposure: 0 },
      onInteractionStart: (zone) => events.push(`start:${zone}`),
      onInteractionChange: (zone, value) => {
        events.push(`preview:${zone}`);
        values = { exposure: value };
      },
      onInteractionCommit: (zone) => events.push(`commit:${zone}`),
      onInteractionCancel: (zone) => events.push(`cancel:${zone}`),
      onInteractionReset: (zone) => events.push(`reset:${zone}`),
    };
    const { container } = render(
      createElement(
        I18nextProvider,
        { i18n: testI18n },
        createElement(HistogramView, {
          histogram: histogram(),
          interactive: true,
          testId: 'tonal-histogram',
          tonalZoneEditor: editor,
        }),
      ),
    );
    const plot = required<HTMLElement>(container, '[data-testid="tonal-histogram"]');
    const overlay = required<HTMLElement>(container, '[data-testid="tonal-histogram-tonal-zones"]');
    setRect(plot, 500);
    setRect(overlay, 500);
    const exposure = required<HTMLButtonElement>(container, '[data-testid="tonal-histogram-tonal-zone-exposure"]');
    setRect(exposure, 100);
    fireEvent.pointerDown(exposure, { clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(plot, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(plot, { clientX: 300, pointerId: 1 });

    expect(events).toEqual(['start:exposure', 'preview:exposure', 'commit:exposure']);
    expect(values.exposure).toBeGreaterThan(0);
  });

  test('supports fine/coarse keyboard changes, reset, and Escape cancellation', () => {
    const events: string[] = [];
    const editor: HistogramTonalZoneEditor = {
      enabled: true,
      values: { blacks: 0 },
      onInteractionStart: (zone) => events.push(`start:${zone}`),
      onInteractionChange: (zone, value) => events.push(`preview:${zone}:${value}`),
      onInteractionCommit: (zone) => events.push(`commit:${zone}`),
      onInteractionCancel: (zone) => events.push(`cancel:${zone}`),
      onInteractionReset: (zone) => events.push(`reset:${zone}`),
    };
    const { container } = render(
      createElement(
        I18nextProvider,
        { i18n: testI18n },
        createElement(HistogramView, {
          histogram: histogram(),
          interactive: true,
          testId: 'keyboard-histogram',
          tonalZoneEditor: editor,
        }),
      ),
    );
    const blacks = required<HTMLButtonElement>(container, '[data-testid="keyboard-histogram-tonal-zone-blacks"]');
    fireEvent.keyDown(blacks, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyUp(blacks, { key: 'ArrowRight' });
    fireEvent.doubleClick(blacks);
    fireEvent.keyDown(blacks, { key: 'ArrowLeft' });
    fireEvent.keyDown(blacks, { key: 'Escape' });

    expect(events).toEqual([
      'start:blacks',
      'preview:blacks:0.2',
      'commit:blacks',
      'reset:blacks',
      'start:blacks',
      'preview:blacks:-1',
      'cancel:blacks',
    ]);
    expect(blacks.getAttribute('aria-valuemin')).toBe('-100');
    expect(blacks.getAttribute('aria-valuemax')).toBe('100');
    expect(blacks.getAttribute('aria-valuetext')).toBe('0');
  });

  test('does not expose editable regions when the histogram is unavailable', () => {
    const editor: HistogramTonalZoneEditor = {
      enabled: false,
      values: {},
      onInteractionStart: () => undefined,
      onInteractionChange: () => undefined,
      onInteractionCommit: () => undefined,
      onInteractionCancel: () => undefined,
      onInteractionReset: () => undefined,
    };
    const { container } = render(
      createElement(
        I18nextProvider,
        { i18n: testI18n },
        createElement(HistogramView, {
          histogram: histogram(),
          interactive: true,
          testId: 'disabled-histogram',
          tonalZoneEditor: editor,
        }),
      ),
    );
    expect(container.querySelector('[data-testid="disabled-histogram-tonal-zones"]')).toBeNull();
  });

  test('commits one intended Basic-tone history entry and aborts a stale image gesture', () => {
    const imagePath = '/private/alaska/_DSC8786.ARW';
    act(() => {
      useEditorStore.getState().hydrateEditorRenderAuthority({
        editDocumentV2: createDefaultEditDocumentV2(),
        histogram: histogram(),
        imageSession: {
          generation: 1,
          id: 'histogram-session',
          path: imagePath,
          source: 'cold-load',
          status: 'ready',
        },
        previewScopeStatus: {
          displayTransformLabel: 'Display P3',
          exportProfileLabel: null,
          exportRenderingIntentLabel: null,
          histogramReady: true,
          path: imagePath,
          renderBasis: 'editor_preview',
          softProofTransformApplied: false,
          sourceLabel: 'Edited preview',
          updatedAt: '2026-07-16T15:00:00.000Z',
          waveformReady: true,
          workingTransformLabel: 'Working RGB',
          warningCodes: [],
        },
        previewScopeRecoveryState: 'idle',
        selectedImage: {
          exif: null,
          height: 4000,
          isRaw: true,
          isReady: true,
          metadata: null,
          originalUrl: null,
          path: imagePath,
          rawDevelopmentReport: null,
          thumbnailUrl: 'data:image/jpeg;base64,AAAA',
          width: 6000,
        },
      });
    });
    const { container } = render(
      createElement(
        I18nextProvider,
        { i18n: testI18n },
        createElement(InspectorAnalyticsHeader, { testId: 'store-histogram' }),
      ),
    );
    const plot = required<HTMLElement>(container, '[data-testid="store-histogram-histogram"]');
    const overlay = required<HTMLElement>(container, '[data-testid="store-histogram-histogram-tonal-zones"]');
    setRect(plot, 500);
    setRect(overlay, 500);
    const highlights = required<HTMLButtonElement>(
      container,
      '[data-testid="store-histogram-histogram-tonal-zone-highlights"]',
    );
    const historyBefore = useEditorStore.getState().history.length;
    const revisionBefore = useEditorStore.getState().adjustmentRevision;
    fireEvent.pointerDown(highlights, { clientX: 350, pointerId: 1 });
    fireEvent.pointerMove(plot, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(plot, { clientX: 400, pointerId: 1 });
    const afterDrag = selectEditDocumentNode(
      useEditorStore.getState().editDocumentV2,
      'scene_global_color_tone',
    ).params;
    expect(afterDrag.highlights).toBeGreaterThan(0);
    expect(useEditorStore.getState().history.length).toBe(historyBefore + 1);
    expect(useEditorStore.getState().adjustmentRevision).toBe(revisionBefore + 1);

    const staleHistory = useEditorStore.getState().history.length;
    fireEvent.pointerDown(highlights, { clientX: 350, pointerId: 2 });
    act(() =>
      useEditorStore.getState().setEditor({
        selectedImage: { ...useEditorStore.getState().selectedImage!, path: '/private/alaska/other.ARW' },
      }),
    );
    fireEvent.pointerMove(plot, { clientX: 450, pointerId: 2 });
    fireEvent.pointerUp(plot, { clientX: 450, pointerId: 2 });
    expect(useEditorStore.getState().history.length).toBe(staleHistory);
  });
});

function required<T extends Element = Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

function setRect(element: HTMLElement, width: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ bottom: 128, height: 128, left: 0, right: width, top: 0, width, x: 0, y: 0 }),
  });
}

function histogram(): ChannelConfig {
  const channel = Array.from({ length: 256 }, (_, index) => (index === 128 ? 100 : 1));
  return {
    [ActiveChannel.Blue]: { color: '#5c91ff', data: channel },
    [ActiveChannel.Green]: { color: '#66d17a', data: channel },
    [ActiveChannel.Luma]: { color: '#d8dde5', data: channel },
    [ActiveChannel.Red]: { color: '#ff625f', data: channel },
  };
}
