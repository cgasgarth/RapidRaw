#!/usr/bin/env bun

import { filmRuntimeProofReceiptV1Schema } from '../../../../packages/rawengine-schema/src/index.ts';

const hash = `sha256:${'a'.repeat(64)}`;
const receipt = {
  contract: 'rapidraw.film_runtime_proof.v1' as const,
  proofLevel: 'native_private_raw_preview_export' as const,
  sourceContentSha256: hash,
  rawDecodeReceiptSha256: hash,
  inputProfileId: 'camera.input.reference.v1',
  inputProfileSha256: hash,
  workingSpace: 'acescg_linear_v1' as const,
  filmProfileRef: { id: 'rapidraw.reference_film.v1', version: '1', contentSha256: hash },
  filmProfileContentSha256: hash,
  filmNodeSha256: hash,
  compiledProfileSha256: hash,
  executionPlanSha256: hash,
  backend: 'cpu_fallback' as const,
  quality: 'export_full_v1' as const,
  postFilmPreViewSha256: hash,
  viewTransformId: 'rawengine_agx_v1',
  gamutMapperId: 'rawengine.gamut.srgb-oklab-chroma-reduce.v4',
  displayOrOutputProfileSha256: hash,
  previewArtifactSha256: hash,
  exportArtifactSha256: hash,
  previewExportMetrics: {
    changedPixelRatio: 0.42,
    previewExportMeanAbsDelta: 0.001,
    postFilmPreViewHashEqual: true as const,
    sourceHashUnchanged: true as const,
  },
  limitationCodes: ['display_transform_unverified'],
};
const parsed = filmRuntimeProofReceiptV1Schema.parse(receipt);
if (parsed.previewExportMetrics.postFilmPreViewHashEqual !== true)
  throw new Error('Film preview/export parity was not recorded.');
if (
  filmRuntimeProofReceiptV1Schema.safeParse({ ...receipt, filmProfileContentSha256: `sha256:${'b'.repeat(64)}` })
    .success
)
  throw new Error('Mismatched Film profile identity was accepted.');
if (
  filmRuntimeProofReceiptV1Schema.safeParse({
    ...receipt,
    previewExportMetrics: { ...receipt.previewExportMetrics, previewExportMeanAbsDelta: 0.02 },
  }).success
)
  throw new Error('Out-of-tolerance preview/export parity was accepted.');
console.log('film runtime proof receipt ok (identity, parity, limitation guards)');
