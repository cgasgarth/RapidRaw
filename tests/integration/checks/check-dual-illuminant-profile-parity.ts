#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { exportReceiptPayloadSchema } from '../../../src/schemas/tauriEventSchemas.ts';

const fixtureReport = {
  cameraProfile: {
    algorithmId: 'dual_illuminant_mired_v1',
    candidateCount: 2,
    cctClamped: false,
    coolIlluminant: 'D65',
    coolWeight: 0.42,
    estimatedCctKelvin: 5100,
    fallbackReason: null,
    illuminantEstimateConfidence: 'low',
    illuminantEstimateMethod: 'wb_coeff_ratio',
    matrixHash: 'blake3:abcdef0123456789',
    status: 'interpolated',
    warmIlluminant: 'StandardLightA',
    warningCodes: [],
  },
  demosaicPath: 'bayer_hq',
  highlightReconstruction: {
    algorithmId: 'sensor_linear_confidence_hierarchy_v2',
    cfaKind: 'bayer',
    clippedSamples: 12,
    confidencePercentiles: [0.2, 0.45, 0.7, 0.9, 1],
    implementationVersion: 2,
    invalidSamples: 0,
    largestClippedRegion: 5,
    methodCounts: { cross_channel_ratio: 8, same_channel_spatial: 4 },
    mode: 'strong',
    nearClippedSamples: 7,
    partiallyReconstructedSamples: 1,
    postDemosaicFallbackSamples: 0,
    reconstructedSamples: 11,
    unrecoverableSamples: 1,
    warningCodes: ['highlight_reconstruction_partial'],
  },
  processingProfile: 'maximum',
};

const receipt = exportReceiptPayloadSchema.parse({
  completedAt: '2026-06-27T00:00:00.000Z',
  outputs: [
    {
      byteSize: 1024,
      format: 'tiff',
      outputPath: '/private/output.tiff',
      rawProvenanceSidecarPath: '/private/output.tiff.rawengine-provenance.json',
      rawDevelopmentReport: fixtureReport,
      sourcePath: '/private/input.ARW',
    },
  ],
  terminalStatus: 'completed',
  total: 1,
});

const rawReport = receipt.outputs[0]?.rawDevelopmentReport;
const failures = [
  rawReport?.cameraProfile.status === 'interpolated' ? null : 'export receipt did not parse interpolated report',
  rawReport?.cameraProfile.matrixHash === 'blake3:abcdef0123456789' ? null : 'export receipt lost matrix hash',
  rawReport?.processingProfile === 'maximum' ? null : 'export receipt lost RAW processing profile',
  rawReport?.highlightReconstruction.reconstructedSamples === 11
    ? null
    : 'export receipt lost highlight reconstruction report',
  receipt.outputs[0]?.rawProvenanceSidecarPath?.endsWith('.rawengine-provenance.json')
    ? null
    : 'export receipt lost RAW provenance sidecar path',
  hasMarker('src-tauri/src/io/image_loader.rs', 'load_and_composite_with_report')
    ? null
    : 'image loader must expose report-preserving composite helper',
  hasMarker('src-tauri/src/export/export_processing.rs', 'raw_development_report: Option<RawDevelopmentReport>')
    ? null
    : 'export receipt output must carry RAW development report',
  hasMarker('src-tauri/src/export/export_processing.rs', 'write_raw_export_provenance_sidecar')
    ? null
    : 'export path must write RAW development provenance sidecar',
  hasMarker('src-tauri/src/export/export_processing.rs', 'load_and_composite_with_report')
    ? null
    : 'export path must call report-preserving composite helper',
  hasMarker('src/components/ui/ExportImportProperties.ts', 'rawDevelopmentReport?: RawDevelopmentReport')
    ? null
    : 'TS export receipt type must expose rawDevelopmentReport',
].filter((failure): failure is string => failure !== null);

if (failures.length > 0) {
  console.error(`dual-illuminant parity check failed: ${failures.join('; ')}`);
  process.exit(1);
}

console.log('dual-illuminant profile parity ok');

function hasMarker(path: string, marker: string): boolean {
  return readFileSync(path, 'utf8').includes(marker);
}
