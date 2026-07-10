import { describe, expect, test } from 'bun:test';

import {
  getNextViewerLightsOutLevel,
  resolveViewerEscapeAction,
  resolveViewerFramePresentation,
} from '../../../src/components/panel/editor/viewerPresentationContracts';

describe('viewer presentation contracts', () => {
  test('cycles lights-out through Off, Dim, Black, then Off', () => {
    expect(getNextViewerLightsOutLevel('off')).toBe('dim');
    expect(getNextViewerLightsOutLevel('dim')).toBe('black');
    expect(getNextViewerLightsOutLevel('black')).toBe('off');
  });

  test('gives higher-priority overlays Escape before lights-out and fullscreen', () => {
    expect(
      resolveViewerEscapeAction({
        hasHigherPriorityEscapeOwner: true,
        isFullScreen: true,
        lightsOutLevel: 'black',
      }),
    ).toBe('none');
    expect(
      resolveViewerEscapeAction({
        hasHigherPriorityEscapeOwner: false,
        isFullScreen: true,
        lightsOutLevel: 'black',
      }),
    ).toBe('exit-lights-out');
    expect(
      resolveViewerEscapeAction({
        hasHigherPriorityEscapeOwner: false,
        isFullScreen: true,
        lightsOutLevel: 'off',
      }),
    ).toBe('exit-fullscreen');
  });

  test('keeps the image edge but removes false shadow at inspection zoom', () => {
    expect(resolveViewerFramePresentation({ transformScale: 1, zoomMode: 'fit' })).toEqual({
      edgeVisible: true,
      shadowVisible: true,
    });
    expect(resolveViewerFramePresentation({ transformScale: 2, zoomMode: 'ratio' })).toEqual({
      edgeVisible: true,
      shadowVisible: false,
    });
  });
});
