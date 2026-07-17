import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import DetailLoupe from '../../../src/components/panel/editor/DetailLoupe.tsx';
import en from '../../../src/i18n/locales/en.json';
import {
  createDetailLoupeTarget,
  resolveDetailLoupeBackground,
  resolveDetailLoupePhase,
  resolveDetailModifierPreview,
} from '../../../src/utils/detailLoupe.ts';

const identity = { imageSessionId: 'session-1', renderRevision: 4, sourceIdentity: '/photos/alaska.ARW' } as const;
const target = createDetailLoupeTarget(identity, { x: 0.2, y: 0.8 });

describe('detail loupe', () => {
  test('clamps crosshair targets and rejects stale source or render identity', () => {
    expect(createDetailLoupeTarget(identity, { x: -1, y: 2 })).toMatchObject({ x: 0, y: 1, ...identity });
    expect(
      resolveDetailLoupePhase({ currentIdentity: identity, previewUrl: 'preview', resolutionState: 'ready', target }),
    ).toBe('current');
    expect(
      resolveDetailLoupePhase({
        currentIdentity: { ...identity, renderRevision: 5 },
        previewUrl: 'preview',
        resolutionState: 'ready',
        target,
      }),
    ).toBe('pending');
    expect(
      resolveDetailLoupePhase({
        currentIdentity: identity,
        previewUrl: 'preview',
        resolutionState: 'settling',
        target,
      }),
    ).toBe('pending');
  });

  test('maps orientation, DPR, source resolution, and target into a deterministic 1:1 background', () => {
    const style = resolveDetailLoupeBackground({
      devicePixelRatio: 2,
      imageRect: { height: 400, width: 600, x: 0, y: 0 },
      orientationSteps: -1,
      sourceSize: { height: 4000, width: 6000 },
      target,
    });
    expect(style.backgroundPosition).toBe('20% 80%');
    expect(style.backgroundSize).toBe('12000px 8000px');
    expect(style.transform).toBe('rotate(270deg)');
  });

  test('Alt diagnostics are transient and only active while a supported slider is dragging', () => {
    expect(resolveDetailModifierPreview({ altKey: false, dragging: true, hovered: 'sharpening' })).toBeNull();
    expect(resolveDetailModifierPreview({ altKey: true, dragging: false, hovered: 'sharpening' })).toBeNull();
    expect(resolveDetailModifierPreview({ altKey: true, dragging: true, hovered: 'noise-reduction' })).toBe(
      'noise-reduction',
    );
  });

  test('renders current, pending, and diagnostic state without writing an edit', async () => {
    const i18n = i18next.createInstance();
    await i18n.use(initReactI18next).init({
      interpolation: { escapeValue: false },
      lng: 'en',
      resources: { en: { translation: en } },
    });
    const view = render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(DetailLoupe, {
          currentIdentity: identity,
          devicePixelRatio: 1,
          diagnosticMode: 'sharpening',
          imageRect: { height: 400, width: 600, x: 0, y: 0 },
          orientationSteps: 0,
          previewUrl: 'data:image/png;base64,AAAA',
          resolutionState: 'ready',
          sourceSize: { height: 4000, width: 6000 },
          target,
        }),
      ),
    );
    expect(view.container.querySelector('[data-detail-loupe-phase="current"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="detail-loupe-diagnostic-label"]')?.textContent).toContain(
      'Sharpening',
    );
    view.rerender(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(DetailLoupe, {
          currentIdentity: { ...identity, renderRevision: 5 },
          devicePixelRatio: 1,
          imageRect: { height: 400, width: 600, x: 0, y: 0 },
          orientationSteps: 0,
          previewUrl: 'data:image/png;base64,AAAA',
          resolutionState: 'ready',
          sourceSize: { height: 4000, width: 6000 },
          target,
        }),
      ),
    );
    expect(view.container.querySelector('[data-detail-loupe-phase="pending"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="detail-loupe-pixels"]')).toBeNull();
  });
});
