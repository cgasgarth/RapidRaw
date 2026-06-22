#!/usr/bin/env bun

import { buildHdrBracketPreflight } from '../../../src/utils/hdrBracketPreflight.ts';

const accepted = buildHdrBracketPreflight([
  {
    exif: { ExposureTime: '1/250', FNumber: '5.6', ISO: '100', LensModel: 'NIKKOR Z', Make: 'Nikon' },
    path: '/hdr/frame-under.nef',
  },
  {
    exif: { ExposureTime: '1/60', FNumber: '5.6', ISO: '100', LensModel: 'NIKKOR Z', Make: 'Nikon' },
    path: '/hdr/frame-mid.nef',
  },
  {
    exif: { ExposureTime: '1/15', FNumber: '5.6', ISO: '100', LensModel: 'NIKKOR Z', Make: 'Nikon' },
    path: '/hdr/frame-over.nef',
  },
]);

if (!accepted?.accepted) {
  throw new Error(`Expected accepted HDR bracket preflight, got ${accepted?.blockCodes.join(',') ?? 'null'}.`);
}
if (accepted.detectionMethod !== 'metadata_exposure_time_iso_aperture') {
  throw new Error(`Expected metadata exposure method, got ${accepted.detectionMethod}.`);
}
if (accepted.bracketSpanEv < 3.9) {
  throw new Error(`Expected about 4 EV span, got ${accepted.bracketSpanEv}.`);
}

const blocked = buildHdrBracketPreflight([
  { exif: {}, path: '/hdr/no-exif-1.nef' },
  { exif: {}, path: '/hdr/no-exif-2.nef' },
]);
if (blocked?.accepted || !blocked?.blockCodes.includes('missing_required_exposure_metadata')) {
  throw new Error('Expected missing exposure metadata to block HDR bracket preflight.');
}

console.log('hdr bracket preflight UI ok');
