import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import DetailsPanel from '../../../src/components/adjustments/Details';
import en from '../../../src/i18n/locales/en.json';
import { type Adjustments, INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const happyWindow = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  document: happyWindow.document,
  HTMLElement: happyWindow.HTMLElement,
  MouseEvent: happyWindow.MouseEvent,
  navigator: happyWindow.navigator,
  window: happyWindow,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

test('legacy edits stay legacy while explicit multiscale settings round-trip', () => {
  const legacy = normalizeLoadedAdjustments({ sharpness: 24, clarity: 18, structure: -8 });
  expect(legacy.multiscaleDetail.process).toBe('legacy_v1');
  expect(legacy).toMatchObject({ sharpness: 24, clarity: 18, structure: -8 });

  const reopened = normalizeLoadedAdjustments({
    multiscaleDetail: {
      ...INITIAL_ADJUSTMENTS.multiscaleDetail,
      coarse: -12,
      finest: 31,
      noiseProtection: 74,
      process: 'multiscale_v1',
    },
  });
  expect(reopened.multiscaleDetail).toMatchObject({
    coarse: -12,
    finest: 31,
    noiseProtection: 74,
    process: 'multiscale_v1',
  });
});

test('multiscale switch reveals the advanced equalizer and commits one settings object', async () => {
  let current = structuredClone(INITIAL_ADJUSTMENTS);
  const rendered = await renderDetails((adjustments) => {
    current = adjustments;
  });
  const toggle = rendered.querySelector<HTMLInputElement>('#switch-use-multiscale-detail');
  expect(toggle).not.toBeNull();

  await act(async () => {
    toggle?.click();
    await Promise.resolve();
  });

  expect(current.multiscaleDetail.process).toBe('multiscale_v1');
  expect(rendered.textContent).toContain('Advanced detail equalizer');
  expect(rendered.textContent).toContain('Noise protection');
  expect(rendered.textContent).toContain('Texture');
});

function Harness({ onChange }: { onChange: (adjustments: Adjustments) => void }) {
  const [adjustments, setAdjustments] = useState(structuredClone(INITIAL_ADJUSTMENTS));
  return createElement(DetailsPanel, {
    adjustments,
    appSettings: null,
    setAdjustments: (update) => {
      setAdjustments((previous) => {
        const next = typeof update === 'function' ? update(previous) : { ...previous, ...update };
        onChange(next);
        return next;
      });
    },
  });
}

async function renderDetails(onChange: (adjustments: Adjustments) => void): Promise<HTMLDivElement> {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(I18nextProvider, { i18n: instance }, createElement(Harness, { onChange })));
    await Promise.resolve();
  });
  return container;
}
