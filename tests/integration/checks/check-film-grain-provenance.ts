#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  applyFilmGrainProvenanceToSidecar,
  buildFilmGrainSidecarProvenance,
  classifyFilmGrainProvenanceStaleState,
  filmGrainSidecarProvenanceV1Schema,
  readFilmGrainProvenanceFromSidecar,
} from '../../../packages/rawengine-schema/src/filmGrainProvenance.ts';
import { sampleFilmGrainModelV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const REPORT_PATH = 'docs/validation/film-grain-provenance-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');

const reportSchema = z
  .object({
    doesNotProve: z.array(z.enum(['gpu_grain_parity', 'preview_export_parity', 'ui_e2e', 'real_raw_render'])).min(1),
    effectiveSeed: z.number().int().nonnegative(),
    evidenceState: z.literal('synthetic_runtime_reference_only'),
    issue: z.literal(2485),
    provenanceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    provenanceId: z.string().min(1),
    reloadSeedMatch: z.literal(true),
    schemaVersion: z.literal(1),
    sidecarHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    staleReasons: z.array(z.literal('algorithm_version_changed')).length(1),
    validationMode: z.literal('film_grain_sidecar_provenance_roundtrip'),
  })
  .strict();

const sourceContentHash = `sha256:${'a'.repeat(64)}`;
const provenance = buildFilmGrainSidecarProvenance({
  colorDomain: 'display_referred_rgb',
  coordinatePolicy: 'variant_pixel_stable_v1',
  evidenceState: 'synthetic_runtime_reference_only',
  model: sampleFilmGrainModelV1,
  sourceContentHash,
  sourceImageId: 'image_film_grain_provenance_fixture',
  variantId: 'variant_film_grain_001',
});

const initialSidecar = {
  adjustments: {
    grainAmount: provenance.controls.amount,
    grainRoughness: provenance.controls.roughness,
    grainSize: provenance.controls.size,
  },
  rating: 0,
  schemaVersion: 1,
  version: 1,
};

const sidecar = applyFilmGrainProvenanceToSidecar(initialSidecar, provenance);
const reloaded = readFilmGrainProvenanceFromSidecar(JSON.parse(JSON.stringify(sidecar)));
if (reloaded === undefined) throw new Error('Film grain provenance did not roundtrip through sidecar.');
if (reloaded.effectiveSeed !== provenance.effectiveSeed) throw new Error('Film grain seed changed after reload.');
if (JSON.stringify(reloaded.controls) !== JSON.stringify(provenance.controls)) {
  throw new Error('Film grain controls changed after reload.');
}

filmGrainSidecarProvenanceV1Schema.parse(reloaded);

const staleModel = {
  ...sampleFilmGrainModelV1,
  modelVersion: `${sampleFilmGrainModelV1.modelVersion}-next`,
};
const staleState = classifyFilmGrainProvenanceStaleState(provenance, {
  colorDomain: provenance.colorDomain,
  controls: provenance.controls,
  coordinatePolicy: provenance.coordinatePolicy,
  model: staleModel,
  sourceContentHash,
});
if (staleState.state !== 'stale' || !staleState.invalidationReasons.includes('algorithm_version_changed')) {
  throw new Error('Film grain provenance must become stale after algorithm/model version changes.');
}

const currentState = classifyFilmGrainProvenanceStaleState(provenance, {
  colorDomain: provenance.colorDomain,
  controls: provenance.controls,
  coordinatePolicy: provenance.coordinatePolicy,
  model: sampleFilmGrainModelV1,
  sourceContentHash,
});
if (currentState.state !== 'current') throw new Error('Unchanged film grain provenance should stay current.');

const report = reportSchema.parse({
  doesNotProve: ['gpu_grain_parity', 'preview_export_parity', 'ui_e2e', 'real_raw_render'],
  effectiveSeed: provenance.effectiveSeed,
  evidenceState: provenance.evidenceState,
  issue: 2485,
  provenanceHash: hashJson(provenance),
  provenanceId: provenance.provenanceId,
  reloadSeedMatch: reloaded.effectiveSeed === provenance.effectiveSeed,
  schemaVersion: 1,
  sidecarHash: hashJson(sidecar),
  staleReasons: staleState.invalidationReasons,
  validationMode: 'film_grain_sidecar_provenance_roundtrip',
});

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:film-grain-provenance:update.`);
  }
}

console.log(`film grain provenance ok (seed=${report.effectiveSeed})`);

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
