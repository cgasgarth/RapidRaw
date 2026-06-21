#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale, packageJson] = await Promise.all([
  readFile('src/components/panel/right/ExportPanel.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  export?: { readiness?: Record<string, string> };
};

const requiredSourceSnippets = [
  'exportReadinessItems',
  'selectedColorProfileLabel',
  'selectedResizeModeLabel',
  'data-testid="export-readiness-summary"',
  'data-export-readiness-item={item}',
  'export.readiness.metadataWithoutGps',
];
const requiredKeys = [
  'format',
  'colorProfile',
  'lutProfile',
  'resizeEnabled',
  'resizeOff',
  'watermarkOn',
  'watermarkOff',
  'metadataOn',
  'metadataOff',
  'metadataWithoutGps',
];
const readinessKeys = localeJson.export?.readiness ?? {};
const failures = [
  ...requiredSourceSnippets.filter((snippet) => !source.includes(snippet)).map((snippet) => `missing: ${snippet}`),
  ...requiredKeys.filter((key) => readinessKeys[key] === undefined).map((key) => `missing locale: ${key}`),
];

if (!packageJson.includes('"check:export-readiness-ui"')) {
  failures.push('missing package script: check:export-readiness-ui');
}

if (failures.length > 0) {
  console.error('export readiness UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('export readiness UI ok');
