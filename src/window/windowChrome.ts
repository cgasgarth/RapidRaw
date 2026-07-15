export interface WindowChromeInput {
  decorationsEnabled: boolean;
  isWindowFullScreen: boolean;
  osPlatform: string;
}

export interface WindowChromeLayout {
  compactTopUiHeight: number;
  kind: 'custom-titlebar' | 'macos-overlay' | 'native';
  reserveCollapsedLeadingWidth: number;
}

export function resolveWindowChromeLayout({
  decorationsEnabled,
  isWindowFullScreen,
  osPlatform,
}: WindowChromeInput): WindowChromeLayout {
  if (!osPlatform) {
    return {
      compactTopUiHeight: 60,
      kind: 'native',
      reserveCollapsedLeadingWidth: 32,
    };
  }

  if (osPlatform === 'macos' && !isWindowFullScreen) {
    return {
      compactTopUiHeight: 60,
      kind: 'macos-overlay',
      reserveCollapsedLeadingWidth: 80,
    };
  }

  if (!decorationsEnabled && !isWindowFullScreen) {
    return {
      compactTopUiHeight: 110,
      kind: 'custom-titlebar',
      reserveCollapsedLeadingWidth: 32,
    };
  }

  return {
    compactTopUiHeight: 60,
    kind: 'native',
    reserveCollapsedLeadingWidth: 32,
  };
}
