import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { ViewerSamplerHud } from '../../../src/components/panel/editor/ViewerSamplerHud';
import en from '../../../src/i18n/locales/en.json';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  defaultNS: 'translation',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const renderHud = (props: Parameters<typeof ViewerSamplerHud>[0]): string =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(ViewerSamplerHud, props)));

describe('ViewerSamplerHud', () => {
  test('renders image coordinates, RGB/luma, clipping, and explicit domain', () => {
    const markup = renderHud({
      locked: true,
      onToggleLock: () => {},
      result: {
        status: 'available',
        requestIdentity: 'sample-1',
        imagePointPx: { x: 143, y: 92 },
        rgb: [1, 0.5, 0.25],
        luma: 0.58825,
        clippedChannels: ['r'],
        spaceLabel: 'Soft proof · Display P3',
      },
      suppressed: false,
      target: 'softProof',
    });

    expect(markup).toContain('X 143 Y 92');
    expect(markup).toContain('R 255 G 128 B 64');
    expect(markup).toContain('Y 58.8%');
    expect(markup).toContain('Clip r');
    expect(markup).toContain('Soft proof · Display P3');
    expect(markup).toContain('data-sampler-locked="true"');
  });

  test('reports suppression and unavailable state without retaining values', () => {
    const paused = renderHud({
      locked: false,
      onToggleLock: () => {},
      result: null,
      suppressed: true,
      target: 'edited',
    });
    expect(paused).toContain('Paused');
    expect(paused).not.toContain('R ');
  });
});
