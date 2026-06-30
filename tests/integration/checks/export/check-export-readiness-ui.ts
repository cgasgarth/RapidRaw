#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale] = await Promise.all([
  readFile('src/components/panel/right/export/ExportPanel.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  export?: {
    readiness?: Record<string, string>;
    softProofCompare?: Record<string, string>;
    status?: Record<string, string>;
  };
};

const requiredSourceSnippets = [
  'exportReadinessItems',
  'primaryExportReadinessItems',
  'secondaryExportReadinessItems',
  'selectedColorProfileLabel',
  'selectedResizeModeLabel',
  'data-testid="export-readiness-summary"',
  'data-export-readiness-item={item}',
  'data-testid="export-soft-proof-compare-footer-warning"',
  'data-testid="export-soft-proof-compare-footer-action"',
  'data-testid="export-blocked-alert"',
  'data-testid="export-error-alert"',
  'export.readiness.metadataWithoutGps',
  'export.softProofCompare.footerUnavailableDescription',
  'export.status.estimatePending',
  'Invokes.IsOriginalFileAvailable',
  'originalFileAvailableSchema',
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
const softProofCompareKeys = localeJson.export?.softProofCompare ?? {};
const statusKeys = localeJson.export?.status ?? {};
const failures = [
  ...requiredSourceSnippets.filter((snippet) => !source.includes(snippet)).map((snippet) => `missing: ${snippet}`),
  ...requiredKeys.filter((key) => readinessKeys[key] === undefined).map((key) => `missing locale: ${key}`),
  ...['footerRetry', 'footerUnavailableDescription', 'footerUnavailableTitle']
    .filter((key) => softProofCompareKeys[key] === undefined)
    .map((key) => `missing locale: export.softProofCompare.${key}`),
  ...['estimatePending', 'estimatedAverageSize']
    .filter((key) => statusKeys[key] === undefined)
    .map((key) => `missing locale: export.status.${key}`),
];

if (source.includes('flex flex-wrap justify-center gap-1.5" data-testid="export-readiness-summary"')) {
  failures.push('readiness summary must not render as the old centered badge cloud');
}

if (failures.length > 0) {
  console.error('export readiness UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('export readiness UI ok');
