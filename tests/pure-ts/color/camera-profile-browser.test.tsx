import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { CameraProfileBrowser } from '../../../src/components/adjustments/color/CameraProfileBrowser';
import type { CameraProfileBrowserEntry } from '../../../src/schemas/color/cameraProfileBrowserSchemas';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const dcpId = `dcp:${'a'.repeat(64)}` as const;
const entry: CameraProfileBrowserEntry = {
  cameraModel: 'Sony ILCE-7RM4',
  compatible: true,
  creativeAmountSupported: true,
  contentSha256: `sha256:${'a'.repeat(64)}`,
  displayName: 'Open Neutral',
  favorite: false,
  id: dcpId,
  lastUsedEpochMs: null,
  source: 'user',
};

test('drives search, apply, creative amount, favorite, import and removal as separate actions', async () => {
  installDom();
  const calls: Array<string> = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } } });
  await act(async () =>
    root?.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(CameraProfileBrowser, {
          amount: 65,
          builtIns: [{ id: 'camera_standard', label: 'Camera Standard' }],
          entries: [entry],
          errorCode: null,
          label: 'Profile',
          loading: false,
          onAmountChange: (amount) => calls.push(`amount:${amount}`),
          onImport: () => calls.push('import'),
          onRemove: (id) => calls.push(`remove:${id}`),
          onReveal: (id) => calls.push(`reveal:${id}`),
          onSelect: (id) => calls.push(`select:${id}`),
          selected: dcpId,
        }),
      ),
    ),
  );
  const amount = container.querySelector<HTMLInputElement>('input[aria-label="Profile amount"]');
  expect(amount?.value).toBe('65');
  await act(async () => {
    container?.querySelector<HTMLButtonElement>('button[aria-label="Profile"]')?.click();
  });
  expect(container.textContent).toContain('Open Neutral');
  await act(async () => {
    container?.querySelector<HTMLButtonElement>('button[aria-label="Favorite Open Neutral"]')?.click();
  });
  expect(window.localStorage.getItem('rapidraw.camera-profile-browser.v1')).toContain(dcpId);
  await act(async () => {
    container?.querySelector<HTMLButtonElement>('button[aria-label="Remove Open Neutral"]')?.click();
    container?.querySelector<HTMLButtonElement>('button[aria-label="Reveal Open Neutral"]')?.click();
    container?.querySelector<HTMLButtonElement>('[data-testid="camera-profile-import"]')?.click();
  });
  expect(calls).toEqual([`remove:${dcpId}`, `reveal:${dcpId}`, 'import']);
});

function installDom() {
  const window = new Window({ url: 'http://localhost/camera-profile-browser-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window, writable: true });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: window.document,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: window.navigator,
    writable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: window.HTMLElement,
    writable: true,
  });
  Object.defineProperty(globalThis, 'HTMLInputElement', {
    configurable: true,
    value: window.HTMLInputElement,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: window.localStorage,
    writable: true,
  });
}
