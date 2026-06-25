#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { rawDevelopmentReportSchema } from '../../../src/schemas/imageLoaderSchemas.ts';

const fixture = rawDevelopmentReportSchema.parse({
  cameraProfile: {
    algorithmId: 'dual_illuminant_mired_v1',
    candidateCount: 2,
    coolIlluminant: 'D65',
    coolWeight: 0.42,
    estimatedCctKelvin: 5100,
    fallbackReason: null,
    matrixHash: 'blake3:abcdef0123456789',
    status: 'interpolated',
    warmIlluminant: 'StandardLightA',
    warningCodes: [],
  },
  demosaicPath: 'bayer_hq',
});

const files = {
  appProperties: readFileSync('src/components/ui/AppProperties.tsx', 'utf8'),
  cacheUtils: readFileSync('src-tauri/src/cache_utils.rs', 'utf8'),
  imageLoader: readFileSync('src-tauri/src/image_loader.rs', 'utf8'),
  metadataPanel: readFileSync('src/components/panel/right/MetadataPanel.tsx', 'utf8'),
  schemas: readFileSync('src/schemas/imageLoaderSchemas.ts', 'utf8'),
  useAppNavigation: readFileSync('src/hooks/useAppNavigation.ts', 'utf8'),
  useImageLoader: readFileSync('src/hooks/useImageLoader.ts', 'utf8'),
};

const requiredMarkers: Array<[keyof typeof files, string]> = [
  ['schemas', 'rawDevelopmentReportSchema'],
  ['schemas', 'rawCameraProfileReportSchema'],
  ['imageLoader', 'pub raw_development_report: Option<RawDevelopmentReport>'],
  ['imageLoader', 'load_base_image_from_bytes_with_report'],
  ['imageLoader', 'add_raw_development_report_exif'],
  ['cacheUtils', 'Option<RawDevelopmentReport>'],
  ['cacheUtils', 'raw_development_report: Option<RawDevelopmentReport>'],
  ['appProperties', 'rawDevelopmentReport?: RawDevelopmentReport | null'],
  ['useImageLoader', 'rawDevelopmentReport: loadImageResult.raw_development_report ?? null'],
  ['useAppNavigation', 'rawDevelopmentReport: result.raw_development_report ?? null'],
  ['metadataPanel', 'data-testid="metadata-camera-profile-report"'],
  ['metadataPanel', 'data-camera-profile-status={cameraProfileReport.status}'],
  ['metadataPanel', "data-camera-profile-matrix-hash={cameraProfileReport.matrixHash ?? ''}"],
];

const missing = requiredMarkers.filter(([file, marker]) => !files[file].includes(marker));
if (missing.length > 0) {
  console.error(
    `camera profile provenance missing markers: ${missing.map(([file, marker]) => `${file}:${marker}`).join('; ')}`,
  );
  process.exit(1);
}

if (fixture.cameraProfile.status !== 'interpolated' || fixture.cameraProfile.matrixHash === null) {
  console.error('camera profile provenance fixture did not parse expected interpolated report');
  process.exit(1);
}

console.log('camera profile provenance ok');
