#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale, packageJson, currentPrLocal] = await Promise.all([
  readFile('src/components/panel/editor/Waveform.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('tests/integration/checks/check-current-pr-local.ts', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  ui?: { waveform?: { clippingReadouts?: Record<string, string> } };
};

const requiredSourceSnippets = [
  'getHistogramClippingSummary',
  'channel.data[0]',
  'channel.data.at(-1)',
  'data-testid="histogram-clipping-readouts"',
  'data-shadow-clipping={shadowClipLabel}',
  'data-highlight-clipping={highlightClipLabel}',
  'ui.waveform.clippingReadouts.shadows',
  'ui.waveform.clippingReadouts.highlights',
];

const missingSource = requiredSourceSnippets.filter((snippet) => !source.includes(snippet));
const readouts = localeJson.ui?.waveform?.clippingReadouts ?? {};
const missingLocale = ['shadows', 'highlights'].filter((key) => readouts[key] === undefined);
const failures = [
  ...missingSource.map((snippet) => `missing Waveform snippet: ${snippet}`),
  ...missingLocale.map((key) => `missing locale key: ui.waveform.clippingReadouts.${key}`),
];

if (!packageJson.includes('"check:histogram-clipping-ui"')) {
  failures.push('missing package script: check:histogram-clipping-ui');
}

if (!currentPrLocal.includes("'check:histogram-clipping-ui'")) {
  failures.push('missing current-pr-local route: check:histogram-clipping-ui');
}

if (failures.length > 0) {
  console.error('histogram clipping UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('histogram clipping UI ok');
