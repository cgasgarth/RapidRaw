import { describe, expect, test } from 'bun:test';

import { resolveWindowChromeLayout } from '../../../src/window/windowChrome.ts';

describe('window chrome layout', () => {
  test('does not flash a custom bar before the native platform resolves', () => {
    expect(
      resolveWindowChromeLayout({
        decorationsEnabled: false,
        isWindowFullScreen: false,
        osPlatform: '',
      }).kind,
    ).toBe('native');
  });

  test('uses the macOS overlay even when stale settings disabled decorations', () => {
    expect(
      resolveWindowChromeLayout({
        decorationsEnabled: false,
        isWindowFullScreen: false,
        osPlatform: 'macos',
      }),
    ).toEqual({
      compactTopUiHeight: 36,
      kind: 'macos-overlay',
      reserveCollapsedLeadingWidth: 80,
    });
  });

  test('keeps the custom bar contract on undecorated Windows and Linux windows', () => {
    for (const osPlatform of ['windows', 'linux']) {
      expect(
        resolveWindowChromeLayout({
          decorationsEnabled: false,
          isWindowFullScreen: false,
          osPlatform,
        }),
      ).toMatchObject({ compactTopUiHeight: 84, kind: 'custom-titlebar' });
    }
  });

  test('does not reserve overlay or custom chrome in native fullscreen', () => {
    expect(
      resolveWindowChromeLayout({
        decorationsEnabled: false,
        isWindowFullScreen: true,
        osPlatform: 'macos',
      }),
    ).toEqual({
      compactTopUiHeight: 36,
      kind: 'native',
      reserveCollapsedLeadingWidth: 32,
    });
  });
});
