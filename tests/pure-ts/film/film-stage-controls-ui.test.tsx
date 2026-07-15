import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next, { type i18n } from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import FilmStageControls from '../../../src/components/film/FilmStageControls';
import en from '../../../src/i18n/locales/en.json';
import { getFilmStageControlDescriptors } from '../../../src/utils/film-look/filmStageControls';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const responseLabelKey = 'adjustments.effects.filmStages.responseP';

const createTestI18n = async (resources: Record<string, unknown> = {}): Promise<i18n> => {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    fallbackLng: 'en',
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: resources } },
  });
  return instance;
};

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  Object.assign(globalThis, { document: originalDocument, window: originalWindow });
});

describe('Film stage controls UI', () => {
  test('renders renderer descriptor and routes value/reset interactions', async () => {
    const window = new Window();
    Object.assign(globalThis, { document: window.document, window });
    container = window.document.createElement('div');
    window.document.body.append(container);
    const descriptor = getFilmStageControlDescriptors()[0];
    if (descriptor === undefined) throw new Error('Expected response descriptor');
    const changes: number[] = [];
    const resets: string[] = [];
    const translations = await createTestI18n();
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          I18nextProvider,
          { i18n: translations },
          createElement(FilmStageControls, {
            descriptors: [descriptor],
            onChange: (_descriptor, value) => changes.push(value),
            onReset: (resetDescriptor) => resets.push(resetDescriptor.parameterId),
          }),
        ),
      );
    });
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider?.getAttribute('aria-label')).toBe(`${responseLabelKey} slider`);
    expect(container.querySelector('[data-stage-modified="false"]')).not.toBeNull();
    if (slider === null) throw new Error('Expected descriptor slider');
    await act(async () => {
      slider.value = '1.25';
      slider.dispatchEvent(new window.Event('input', { bubbles: true }));
      const reactPropsKey = Object.keys(slider).find((key) => key.startsWith('__reactProps$'));
      const reactProps = reactPropsKey === undefined ? null : Reflect.get(slider, reactPropsKey);
      if (typeof reactProps?.onChange !== 'function') throw new Error('Expected slider change handler');
      reactProps.onChange({ currentTarget: slider, target: slider });
    });
    expect(changes).toEqual([1.25]);
    const modifiedDescriptor = getFilmStageControlDescriptors(1.25)[0];
    if (modifiedDescriptor === undefined) throw new Error('Expected modified response descriptor');
    await act(async () => {
      root?.render(
        createElement(
          I18nextProvider,
          { i18n: translations },
          createElement(FilmStageControls, {
            descriptors: [modifiedDescriptor],
            onChange: (_descriptor, value) => changes.push(value),
            onReset: (resetDescriptor) => resets.push(resetDescriptor.parameterId),
          }),
        ),
      );
    });
    const reset = container.querySelector<HTMLButtonElement>('button[aria-label*="Reset"]');
    expect(reset).not.toBeNull();
    await act(async () => reset?.click());
    expect(resets).toEqual(['reference_luminance_shaper_p']);
  });

  test('isolates raw-key fixtures from translated instances in either order and during concurrent setup', async () => {
    const isolatedFirst = await createTestI18n();
    const translatedSecond = await createTestI18n(en);
    expect(isolatedFirst.t(responseLabelKey)).toBe(responseLabelKey);
    expect(translatedSecond.t(responseLabelKey)).toBe('Response shape');

    const translatedFirst = await createTestI18n(en);
    const isolatedSecond = await createTestI18n();
    expect(isolatedSecond.t(responseLabelKey)).toBe(responseLabelKey);
    expect(translatedFirst.t(responseLabelKey)).toBe('Response shape');

    const [translatedConcurrent, isolatedConcurrent] = await Promise.all([createTestI18n(en), createTestI18n()]);
    expect(translatedConcurrent.t(responseLabelKey)).toBe('Response shape');
    expect(isolatedConcurrent.t(responseLabelKey)).toBe(responseLabelKey);
  });
});
