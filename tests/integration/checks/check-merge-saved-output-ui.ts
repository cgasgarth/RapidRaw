#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { getDisplayFileName } from '../../../src/utils/displayFilePath.ts';

const localePaths = [
  'src/i18n/locales/de.json',
  'src/i18n/locales/en.json',
  'src/i18n/locales/pl.json',
  'src/i18n/locales/zh-CN.json',
];

const basenameCases = new Map([
  ['/tmp/rawengine/hdr-output.tif', 'hdr-output.tif'],
  ['C:\\Users\\cgas\\Pictures\\panorama-output.tif', 'panorama-output.tif'],
  ['relative/merged-output.jpg', 'merged-output.jpg'],
  ['/tmp/rawengine/output-folder/', 'output-folder'],
]);

for (const [input, expected] of basenameCases) {
  const actual = getDisplayFileName(input);
  if (actual !== expected) {
    console.error(`Saved output basename mismatch for ${input}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}

for (const localePath of localePaths) {
  const locale = JSON.parse(readFileSync(localePath, 'utf8'));
  const commonLocale = locale.modals?.common;
  for (const key of ['savedOutputFullPath', 'savedOutputLabel']) {
    if (typeof commonLocale?.[key] !== 'string' || !commonLocale[key].includes('{{')) {
      console.error(`Missing saved output locale ${key} in ${localePath}`);
      process.exit(1);
    }
  }
}

const mergeStatusSource = readFileSync('src/components/modals/computational-merge/MergeStatusViews.tsx', 'utf8');
for (const marker of [
  'getDisplayFileName(savedPath)',
  'data-testid="merge-saved-output-detail"',
  'data-saved-output-name={savedOutputName}',
  'title={savedPath}',
  'aria-hidden="true"',
  'className="sr-only"',
  'modals.common.savedOutputLabel',
  'modals.common.savedOutputFullPath',
]) {
  if (!mergeStatusSource.includes(marker)) {
    console.error(`Merge saved output UI missing marker: ${marker}`);
    process.exit(1);
  }
}

const hdrSource = readFileSync('src/components/modals/computational-merge/HdrModal.tsx', 'utf8');
const panoramaSource = readFileSync('src/components/modals/computational-merge/PanoramaModal.tsx', 'utf8');
for (const [label, source, successMarker] of [
  ['HDR', hdrSource, "savedSuccessLabel={t('modals.hdr.savedSuccess')}"],
  ['panorama', panoramaSource, "savedSuccessLabel={t('modals.panorama.savedSuccess')}"],
] as const) {
  for (const marker of ['<MergeResultPreview', 'savedPath={savedPath}', successMarker]) {
    if (!source.includes(marker)) {
      console.error(`${label} saved output UI missing marker: ${marker}`);
      process.exit(1);
    }
  }
}

console.log('merge saved output UI ok');
