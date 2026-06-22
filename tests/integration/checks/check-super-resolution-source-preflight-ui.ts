#!/usr/bin/env bun

import {
  buildSuperResolutionSourcePreflight,
  createSuperResolutionSourcePreflightMetadata,
} from '../../../src/utils/superResolutionSourcePreflight.ts';

const failures: string[] = [];

const paths = [
  '/raw/sr_dx-0_dy-0_0.ARW',
  '/raw/sr_dx-1_dy-0_1.ARW',
  '/raw/sr_dx-0_dy-1_2.ARW',
  '/raw/sr_dx-1_dy-1_3.ARW',
];
const imageRecords = paths.map((path) => ({
  exif: {
    ExifImageHeight: '6336',
    ExifImageWidth: '9504',
    ISO: '100',
    LensModel: 'FE 50mm F1.4 GM',
    Make: 'Sony',
    Model: 'ILCE-7RM5',
  },
  path,
}));

const metadata = createSuperResolutionSourcePreflightMetadata(paths, imageRecords);
const ready = buildSuperResolutionSourcePreflight({ requestedScale: 2, sources: metadata });
if (ready.status !== 'ready') failures.push(`expected ready status, got ${ready.status}.`);
if (ready.validation?.effectiveScale !== 2) failures.push('expected x2 effective scale.');
if (ready.validation?.sourceMetadata[0]?.resolvedShiftRole !== 'reference') {
  failures.push('expected first dx0/dy0 frame to be reference.');
}

const missingMetadata = buildSuperResolutionSourcePreflight({
  requestedScale: 2,
  sources: [{ imagePath: '/raw/no-dimensions.ARW', sourceIndex: 0 }],
});
if (missingMetadata.status !== 'metadata_missing') failures.push('expected metadata_missing status.');

const blocked = buildSuperResolutionSourcePreflight({
  requestedScale: 2,
  sources: [metadata[0], { ...metadata[1], width: 9000 }],
});
if (blocked.status !== 'blocked') failures.push('expected dimension mismatch to block preflight.');
if (!blocked.validation?.blockCodes.includes('dimension_mismatch')) failures.push('expected dimension_mismatch block.');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('super-resolution source preflight ui ok');
