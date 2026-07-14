import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import FilmStageControls from '../../../src/components/film/FilmStageControls';
import { getFilmStageControlDescriptors } from '../../../src/utils/film-look/filmStageControls';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

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
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(FilmStageControls, {
          descriptors: [descriptor],
          onChange: (_descriptor, value) => changes.push(value),
          onReset: (resetDescriptor) => resets.push(resetDescriptor.parameterId),
        }),
      );
    });
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider?.getAttribute('aria-label')).toBe('adjustments.effects.filmStages.responseP slider');
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
    await act(async () => {
      root?.render(
        createElement(FilmStageControls, {
          descriptors: [getFilmStageControlDescriptors(1.25)[0]!],
          onChange: (_descriptor, value) => changes.push(value),
          onReset: (resetDescriptor) => resets.push(resetDescriptor.parameterId),
        }),
      );
    });
    const reset = container.querySelector<HTMLButtonElement>('button[aria-label*="Reset"]');
    expect(reset).not.toBeNull();
    await act(async () => reset?.click());
    expect(resets).toEqual(['reference_luminance_shaper_p']);
  });
});
