import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ViewerSamplerHud } from '../../../src/components/panel/editor/ViewerSamplerHud';

describe('ViewerSamplerHud', () => {
  test('renders image coordinates, RGB/luma, clipping, and explicit domain', () => {
    const markup = renderToStaticMarkup(
      createElement(ViewerSamplerHud, {
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
      }),
    );

    expect(markup).toContain('X 143 Y 92');
    expect(markup).toContain('R 255 G 128 B 64');
    expect(markup).toContain('Y 58.8%');
    expect(markup).toContain('Clip r');
    expect(markup).toContain('Soft proof · Display P3');
    expect(markup).toContain('data-sampler-locked="true"');
  });

  test('reports suppression and unavailable state without retaining values', () => {
    const paused = renderToStaticMarkup(
      createElement(ViewerSamplerHud, {
        locked: false,
        onToggleLock: () => {},
        result: null,
        suppressed: true,
        target: 'edited',
      }),
    );
    expect(paused).toContain('Paused');
    expect(paused).not.toContain('R ');
  });
});
