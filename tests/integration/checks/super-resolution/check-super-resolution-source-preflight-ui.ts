#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import {
  buildSuperResolutionSourcePreflight,
  createSuperResolutionSourcePreflightMetadata,
} from '../../../../src/utils/superResolutionSourcePreflight.ts';

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
if (ready.validation?.sourceMetadata.some((source) => source.shiftX !== undefined || source.shiftY !== undefined)) {
  failures.push('source preflight must not infer registration shifts from filenames.');
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

const appModalsSource = readFileSync('src/components/modals/AppModals.tsx', 'utf8');
const modalSource = readFileSync('src/components/modals/computational-merge/SuperResolutionModal.tsx', 'utf8');
if (!appModalsSource.includes('Invokes.PlanSuperResolution')) {
  failures.push('SR Preview must invoke native super-resolution readiness.');
}
if (!appModalsSource.includes('nativeReadiness: readiness')) {
  failures.push('SR Preview must store native readiness instead of a synthetic review.');
}
if (!modalSource.includes('sr-native-readiness-row')) {
  failures.push('SR modal must display native source readiness rows.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('super-resolution source preflight ui ok');
