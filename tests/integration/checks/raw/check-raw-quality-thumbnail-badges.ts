#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { buildRawQualityBadges, formatRawQualityBadgeTooltip } from '../../../../src/utils/rawQualityBadges.ts';

const fixtureBadges = buildRawQualityBadges({
  RawEngineCameraProfileFallbackReason: 'missing_dual_illuminant_profile',
  RawEngineCameraProfileStatus: 'fallback',
  RawEngineCameraProfileWarnings: 'matrix_missing,cct_clamped',
  RawEngineRawProcessingMode: 'fast',
  RawEngineRawProcessingProvenance: 'fast demosaic for responsive culling',
});

if (fixtureBadges.length !== 2) {
  throw new Error(`Expected bounded two-badge RAW quality summary, got ${fixtureBadges.length}.`);
}
if (fixtureBadges[0]?.code !== 'camera_profile_status' || fixtureBadges[0].severity !== 'warning') {
  throw new Error('RAW quality badges must prioritize profile fallback warnings.');
}
if (!formatRawQualityBadgeTooltip(fixtureBadges).includes('missing_dual_illuminant_profile')) {
  throw new Error('RAW quality badge tooltip must expose the profile fallback receipt.');
}

const files = {
  filmstrip: readFileSync('src/components/panel/Filmstrip.tsx', 'utf8'),
  libraryItems: readFileSync('src/components/panel/library/LibraryItems.tsx', 'utf8'),
  utility: readFileSync('src/utils/rawQualityBadges.ts', 'utf8'),
};

const requiredMarkers: Array<[keyof typeof files, string]> = [
  ['utility', 'RawEngineCameraProfileStatus'],
  ['utility', 'RawEngineCameraProfileWarnings'],
  ['utility', 'RawEngineRawProcessingMode'],
  ['libraryItems', 'data-testid="raw-quality-thumbnail-badges"'],
  ['libraryItems', 'data-raw-quality-badge-severity={badge.severity}'],
  ['filmstrip', 'data-testid="filmstrip-raw-quality-badges"'],
  ['filmstrip', 'data-raw-quality-badge-detail={badge.detail}'],
];

const missing = requiredMarkers.filter(([file, marker]) => !files[file].includes(marker));
if (missing.length > 0) {
  throw new Error(
    `RAW quality thumbnail badges missing markers: ${missing.map(([file, marker]) => `${file}:${marker}`).join('; ')}`,
  );
}

console.log('raw quality thumbnail badges ok');
