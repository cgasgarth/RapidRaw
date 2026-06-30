#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { displayPreviewLutStatusSchema } from '../../../../src/schemas/displayProfileSchemas.ts';
import {
  xmpMetadataConflictDecisionSchema,
  xmpMetadataConflictReportSchema,
} from '../../../../src/schemas/xmpMetadataConflictSchemas.ts';
import {
  buildDefaultXmpConflictDecisions,
  buildMetadataReadinessSummary,
  getDisplayPreviewLutLocaleStatus,
} from '../../../../src/utils/metadataPanelContracts.ts';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const displayProfileLocale = locale.editor?.metadata?.displayProfile;
const readinessLocale = locale.editor?.metadata?.readiness;
const xmpConflictLocale = locale.editor?.metadata?.xmpConflicts;

const requireLocaleKeys = (label: string, source: unknown, keys: string[]) => {
  const parsed = z.record(z.string(), z.unknown()).safeParse(source);
  if (!parsed.success) {
    failures.push(`${label} locale block is missing.`);
    return;
  }
  for (const key of keys) {
    if (typeof parsed.data[key] !== 'string') failures.push(`${label} locale missing ${key}.`);
  }
};

requireLocaleKeys('metadata readiness', readinessLocale, [
  'cameraFields_one',
  'cameraFields_other',
  'editableFields_one',
  'editableFields_other',
  'gpsMissing',
  'gpsReady',
  'selectionCount_one',
  'selectionCount_other',
]);
requireLocaleKeys('XMP conflict', xmpConflictLocale, [
  'apply',
  'checking',
  'description',
  'external',
  'local',
  'merge',
  'resolving',
  'title',
]);
requireLocaleKeys('display preview LUT status', displayProfileLocale?.previewLutStatus, [
  'active',
  'fallback',
  'unsupported',
]);
requireLocaleKeys('XMP conflict choices', xmpConflictLocale?.choices, ['external', 'local', 'merge']);

const readiness = buildMetadataReadinessSummary({
  exif: {
    ExposureTime: '1/125',
    FNumber: '5.6',
    FocalLengthIn35mmFilm: '',
    PhotographicSensitivity: 400,
  },
  gpsCoordinates: { lat: 41.88, lon: -87.63 },
  selectionCount: 3,
});
if (readiness.cameraFieldCount !== 3)
  failures.push(`Expected 3 populated camera fields, got ${readiness.cameraFieldCount}.`);
if (readiness.editableFieldCount !== 4)
  failures.push(`Expected 4 editable metadata fields, got ${readiness.editableFieldCount}.`);
if (!readiness.gpsReady) failures.push('Expected GPS readiness for parsed coordinates.');
if (readiness.selectionCount !== 3) failures.push(`Expected selection count 3, got ${readiness.selectionCount}.`);

const activeLut = displayPreviewLutStatusSchema.parse({
  profile: {
    cmm: 'ColorSync',
    displayId: 1,
    iccSha256: `sha256:${'a'.repeat(64)}`,
    profileByteCount: 4096,
    source: 'display',
    status: 'active_profile_loaded',
  },
  sampleCount: 4913,
  size: 17,
  status: 'active_display_transform',
});
if (getDisplayPreviewLutLocaleStatus(activeLut) !== 'active')
  failures.push('Active display LUT did not map to active UI status.');
for (const [status, expected] of [
  ['srgb_fallback_transform', 'fallback'],
  ['unsupported_platform', 'unsupported'],
] as const) {
  const lut = displayPreviewLutStatusSchema.parse({ ...activeLut, status });
  if (getDisplayPreviewLutLocaleStatus(lut) !== expected) {
    failures.push(`${status} display LUT did not map to ${expected}.`);
  }
}
if (displayPreviewLutStatusSchema.safeParse({ ...activeLut, status: 'unchecked' }).success) {
  failures.push('Display preview LUT schema accepted an unsupported status.');
}

const conflictReport = xmpMetadataConflictReportSchema.parse({
  fields: [
    { external: 5, field: 'rating', label: 'Rating', local: 3 },
    { external: 'red', field: 'colorLabel', label: 'Color label', local: 'blue' },
    { external: ['xmp'], field: 'keywords', label: 'Keywords', local: ['local'], merged: ['local', 'xmp'] },
  ],
  path: '/photos/frame.raf',
  xmpPath: '/photos/frame.xmp',
});
const defaultDecisions = buildDefaultXmpConflictDecisions(conflictReport);
if (defaultDecisions.rating !== 'external') failures.push('Rating XMP conflicts should default to external.');
if (defaultDecisions.colorLabel !== 'external') failures.push('Color-label XMP conflicts should default to external.');
if (defaultDecisions.keywords !== 'merge') failures.push('Keyword XMP conflicts should default to merge.');
if (xmpMetadataConflictDecisionSchema.safeParse({ choice: 'overwrite', field: 'rating' }).success) {
  failures.push('XMP conflict decision schema accepted an unsupported choice.');
}

if (failures.length > 0) {
  console.error('metadata panel contract failed');
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('metadata panel contract ok');
