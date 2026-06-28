#!/usr/bin/env bun

import {
  buildFocusStackSourcePreflight,
  createFocusStackSourcePreflightMetadata,
} from '../../../src/utils/focusStackSourcePreflight.ts';

const failures: string[] = [];

const paths = ['/raw/focus-1.ARW', '/raw/focus-2.ARW', '/raw/focus-3.ARW'];
const imageRecords = paths.map((path, index) => ({
  exif: {
    ExifImageHeight: '6336',
    ExifImageWidth: '9504',
    FocusDistance: `${0.25 + index * 0.1}`,
    ISO: '100',
    LensModel: 'FE 90mm F2.8 Macro G OSS',
    Make: 'Sony',
    Model: 'ILCE-7RM5',
    WhiteBalance: 'Manual',
  },
  path,
}));

const metadata = createFocusStackSourcePreflightMetadata(paths, imageRecords);
const ready = buildFocusStackSourcePreflight({ sources: metadata });
if (ready.status !== 'warning')
  failures.push(`expected warning status for unverified RAW geometry, got ${ready.status}.`);
if (!ready.validation?.warningCodes.includes('raw_geometry_unverified')) {
  failures.push('expected raw_geometry_unverified warning.');
}
if (ready.validation?.focusSpanMm !== 200)
  failures.push(`expected 200mm focus span, got ${ready.validation?.focusSpanMm}.`);
if (ready.validation?.sourceMetadata[0]?.resolvedFocusRole !== 'front') {
  failures.push('expected first source to resolve as front focus role.');
}

const missingMetadata = buildFocusStackSourcePreflight({
  sources: [{ imagePath: '/raw/no-dimensions.ARW', sourceIndex: 0 }],
});
if (missingMetadata.status !== 'metadata_missing') failures.push('expected metadata_missing status.');

const blocked = buildFocusStackSourcePreflight({
  sources: [metadata[0], { ...metadata[1], width: 9000 }],
});
if (blocked.status !== 'blocked') failures.push('expected dimension mismatch to block preflight.');
if (!blocked.validation?.blockCodes.includes('dimension_mismatch')) failures.push('expected dimension_mismatch block.');

const warning = buildFocusStackSourcePreflight({
  sources: [metadata[0], { ...metadata[1], exif: { ...imageRecords[1]?.exif, ISO: '800' } }],
});
if (warning.status !== 'warning') failures.push('expected ISO mismatch warning status.');
if (!warning.validation?.warningCodes.includes('exposure_or_iso_mismatch')) {
  failures.push('expected exposure_or_iso_mismatch warning.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('focus stack source preflight ui ok');
