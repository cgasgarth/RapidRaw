import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { CompareOverlay } from '../../../src/components/panel/editor/CompareOverlay.tsx';
import en from '../../../src/i18n/locales/en.json';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  defaultNS: 'translation',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

describe('viewer safe controls', () => {
  test('keeps the image canvas free of persistent compare controls in every viewer layout', () => {
    for (const scenario of [
      { name: 'normal', showSideBySideCompare: false, showSplitCompare: false },
      { name: 'crop', showSideBySideCompare: false, showSplitCompare: false },
      { name: 'compare', showSideBySideCompare: true, showSplitCompare: false },
      { name: 'fullscreen', showSideBySideCompare: false, showSplitCompare: true },
      { name: 'compact', showSideBySideCompare: true, showSplitCompare: false },
    ]) {
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(CompareOverlay, {
            canShowOriginalCompare: true,
            compareOverlayDisabled: false,
            isCompareModeActive: scenario.showSideBySideCompare || scenario.showSplitCompare,
            isMaxZoom: false,
            originalSrc: 'blob:original',
            previewSource: 'blob:preview',
            showSideBySideCompare: scenario.showSideBySideCompare,
            showSplitCompare: scenario.showSplitCompare,
          }),
        ),
      );

      expect(markup, scenario.name).not.toContain('<button');
      expect(markup, scenario.name).not.toContain('editor-preview-compare-strip');
    }
  });

  test('makes side-by-side comparison imagery pointer-transparent to the image interaction surface', () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(CompareOverlay, {
          canShowOriginalCompare: true,
          compareOverlayDisabled: false,
          isCompareModeActive: true,
          isMaxZoom: false,
          originalSrc: 'blob:original',
          previewSource: 'blob:preview',
          showSideBySideCompare: true,
          showSplitCompare: false,
        }),
      ),
    );

    expect(markup).toContain('data-canvas-pointer-owner="pan-zoom"');
    expect(markup).toContain('pointer-events-none');
  });
});
