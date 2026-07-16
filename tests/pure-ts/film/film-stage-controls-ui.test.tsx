import { describe, expect, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import i18next, { type i18n } from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import FilmStageControls from '../../../src/components/film/FilmStageControls';
import en from '../../../src/i18n/locales/en.json';
import { getFilmStageControlDescriptors } from '../../../src/utils/film-look/filmStageControls';

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

describe('Film stage controls UI', () => {
  test('renders renderer descriptor and routes value/reset interactions', async () => {
    const descriptor = getFilmStageControlDescriptors()[0];
    if (descriptor === undefined) throw new Error('Expected response descriptor');
    const changes: number[] = [];
    const resets: string[] = [];
    const translations = await createTestI18n();
    const view = render(
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
    const slider = view.container.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider?.getAttribute('aria-label')).toBe(`${responseLabelKey} slider`);
    expect(view.container.querySelector('[data-stage-modified="false"]')).not.toBeNull();
    if (slider === null) throw new Error('Expected descriptor slider');
    await act(async () => {
      slider.value = '1.25';
      const reactPropsKey = Object.keys(slider).find((key) => key.startsWith('__reactProps$'));
      const reactProps = reactPropsKey === undefined ? null : Reflect.get(slider, reactPropsKey);
      if (typeof reactProps?.onChange !== 'function') throw new Error('Expected slider change handler');
      reactProps.onChange({ currentTarget: slider, target: slider });
    });
    expect(changes).toEqual([1.25]);
    const modifiedDescriptor = getFilmStageControlDescriptors(1.25)[0];
    if (modifiedDescriptor === undefined) throw new Error('Expected modified response descriptor');
    view.rerender(
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
    const reset = view.container.querySelector<HTMLButtonElement>('button[aria-label*="Reset"]');
    expect(reset).not.toBeNull();
    if (reset === null) throw new Error('Expected reset control');
    fireEvent.click(reset);
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
