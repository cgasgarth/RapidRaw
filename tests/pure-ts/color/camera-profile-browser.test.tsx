import { afterEach, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { CameraProfileBrowser } from '../../../src/components/adjustments/color/CameraProfileBrowser';
import type { CameraProfileBrowserEntry } from '../../../src/schemas/color/cameraProfileBrowserSchemas';

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

afterEach(() => {
  window.localStorage.clear();
});

test('drives search, apply, creative amount, favorite, import and removal as separate actions', async () => {
  const calls: Array<string> = [];
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } } });
  const { container, getByRole, getByTestId } = render(
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
  );
  const amount = container.querySelector<HTMLInputElement>('input[aria-label="Profile amount"]');
  expect(amount?.value).toBe('65');
  fireEvent.click(getByRole('button', { name: 'Profile' }));
  expect(container.textContent).toContain('Open Neutral');
  fireEvent.click(getByRole('button', { name: 'Favorite Open Neutral' }));
  expect(window.localStorage.getItem('rapidraw.camera-profile-browser.v1')).toContain(dcpId);
  fireEvent.click(getByRole('button', { name: 'Remove Open Neutral' }));
  fireEvent.click(getByRole('button', { name: 'Reveal Open Neutral' }));
  fireEvent.click(getByTestId('camera-profile-import'));
  expect(calls).toEqual([`remove:${dcpId}`, `reveal:${dcpId}`, 'import']);
});
