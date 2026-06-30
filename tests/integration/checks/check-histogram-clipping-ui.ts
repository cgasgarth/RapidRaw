#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import type { ChannelConfig } from '../../../src/components/adjustments/Curves.tsx';
import Waveform from '../../../src/components/panel/editor/Waveform.tsx';
import { ActiveChannel, DisplayMode } from '../../../src/utils/adjustments.ts';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));

const histogram = createHistogram({
  red: { shadow: 5, midtone: 85, highlight: 10 },
  green: { shadow: 1, midtone: 97, highlight: 2 },
  blue: { shadow: 0, midtone: 99, highlight: 1 },
});

const markup = renderToStaticMarkup(
  createElement(
    I18nextProvider,
    { i18n: await createTestI18n(locale) },
    createElement(Waveform, {
      displayMode: DisplayMode.Histogram,
      histogram,
      setDisplayMode: () => undefined,
      waveformData: null,
    }),
  ),
);

for (const [needle, message] of [
  ['data-testid="histogram-clipping-readouts"', 'histogram readout container did not render'],
  ['data-shadow-clipping="5.0%"', 'shadow clipping should be computed from the largest first-bin channel share'],
  ['data-highlight-clipping="10.0%"', 'highlight clipping should be computed from the largest last-bin channel share'],
  ['Shadows 5.0%', 'localized shadow clipping label did not render'],
  ['Highlights 10.0%', 'localized highlight clipping label did not render'],
]) {
  if (!markup.includes(needle)) failures.push(message);
}

const readouts = locale.ui?.waveform?.clippingReadouts ?? {};
for (const key of ['shadows', 'highlights']) {
  if (typeof readouts[key] !== 'string') {
    failures.push(`missing locale key: ui.waveform.clippingReadouts.${key}`);
  }
}

if (failures.length > 0) {
  console.error('histogram clipping UI failed');
  console.error(failures.slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('histogram clipping UI ok');

function createHistogram({
  blue,
  green,
  red,
}: {
  blue: { highlight: number; midtone: number; shadow: number };
  green: { highlight: number; midtone: number; shadow: number };
  red: { highlight: number; midtone: number; shadow: number };
}): ChannelConfig {
  return {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: createChannelData(blue) },
    [ActiveChannel.Green]: { color: '#6BCB77', data: createChannelData(green) },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: createChannelData({ shadow: 0, midtone: 100, highlight: 0 }) },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: createChannelData(red) },
  };
}

function createChannelData({
  highlight,
  midtone,
  shadow,
}: {
  highlight: number;
  midtone: number;
  shadow: number;
}): number[] {
  const data = Array.from({ length: 256 }, () => 0);
  data[0] = shadow;
  data[128] = midtone;
  data[255] = highlight;
  return data;
}

async function createTestI18n(resources: typeof locale) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: resources } },
  });
  return instance;
}
