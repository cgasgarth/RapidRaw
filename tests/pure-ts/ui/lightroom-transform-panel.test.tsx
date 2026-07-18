import { expect, mock, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import TransformPanel from '../../../src/components/adjustments/Transform';
import TransformLens from '../../../src/components/adjustments/TransformLens';
import en from '../../../src/i18n/locales/en.json';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';

const tauriInvoke = mock(async (_command: string, _args?: unknown) => []);
mock.module('@tauri-apps/api/core', () => ({ invoke: tauriInvoke }));

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: '/fixture/transform-panel.ARW',
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};

test('Transform and Lens Corrections render as isolated Develop surfaces', () => {
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  tauriInvoke.mockClear();
  const transform = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(TransformLens, {
        adjustments,
        mode: 'transform',
        selectedImage,
        setAdjustments: mock(() => undefined),
      }),
    ),
  );

  expect(transform.container.querySelector('[data-testid="perspective-correction-controls"]')).not.toBeNull();
  expect(transform.container.querySelector('[data-testid="transform-controls"]')).not.toBeNull();
  expect(transform.container.querySelector('[data-testid="lens-correction-controls"]')).toBeNull();
  expect(transform.container.querySelector('#switch-profile-distortion')).toBeNull();
  expect(tauriInvoke.mock.calls.some(([command]) => command === 'get_lensfun_makers')).toBe(false);

  transform.unmount();
  const lens = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(TransformLens, {
        adjustments,
        mode: 'lens',
        selectedImage,
        setAdjustments: mock(() => undefined),
      }),
    ),
  );

  expect(lens.container.querySelector('[data-testid="lens-correction-controls"]')).not.toBeNull();
  expect(lens.container.querySelector('[data-testid="perspective-correction-controls"]')).toBeNull();
  expect(lens.container.querySelector('[data-testid="transform-controls"]')).toBeNull();

  const distortionSwitch = lens.container.querySelector('#switch-profile-distortion');
  expect(distortionSwitch).not.toBeNull();
  if (!(distortionSwitch instanceof HTMLInputElement)) throw new Error('missing lens distortion switch');
  fireEvent.click(distortionSwitch);
  expect(distortionSwitch.checked).toBeFalse();
  lens.unmount();
});

test('Transform owns the complete geometry surface and exposes typed-control hooks', () => {
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  const setAdjustments = mock(() => undefined);
  const onReset = mock(() => undefined);
  const view = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(TransformPanel, {
        adjustments,
        onReset,
        selectedImage,
        setAdjustments,
      }),
    ),
  );

  expect(view.container.querySelector('[data-testid="transform-panel"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="transform-mode-row"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="transform-aspect-range"]')).not.toBeNull();
  const reset = view.container.querySelector<HTMLButtonElement>('[data-testid="transform-reset"]');
  if (reset === null) throw new Error('Expected Transform reset control.');
  expect(reset.disabled).toBe(true);

  const aspect = view.container.querySelector<HTMLInputElement>('[data-testid="transform-aspect-range"]');
  if (aspect === null) throw new Error('Expected Transform aspect control.');
  fireEvent.input(aspect, { target: { value: '12' } });
  expect(setAdjustments).toHaveBeenCalled();
  view.unmount();
});
