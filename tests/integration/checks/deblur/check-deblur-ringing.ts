#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseDeblurFixtureManifest } from '../../../../src/schemas/deblurFixtureSchemas.ts';

const manifest = parseDeblurFixtureManifest(
  JSON.parse(await readFile('fixtures/detail/deblur/deblur-fixtures.json', 'utf8')),
);
const failures = [];

for (const fixture of manifest.fixtures) {
  const metrics = fixture.expectedMetrics;

  if (fixture.acceptancePolicy.action === 'accept') {
    if (metrics.ringingOvershootRatio.max > 0.06) {
      failures.push(`${fixture.fixtureId}: accepted fixture allows ringing overshoot above 0.06.`);
    }
    if (metrics.haloWidthPx.max > 1.75) {
      failures.push(`${fixture.fixtureId}: accepted fixture allows halo width above 1.75 px.`);
    }
    if (metrics.falseEdgeRatio.max > 0.035) {
      failures.push(`${fixture.fixtureId}: accepted fixture allows too many false edges.`);
    }
    if (metrics.noiseAmplificationRatio.max > 1.2) {
      failures.push(`${fixture.fixtureId}: accepted fixture allows too much noise amplification.`);
    }
    continue;
  }

  const reasons = new Set(fixture.acceptancePolicy.rejectionReasons);
  const hasRingingEvidence = metrics.ringingOvershootRatio.min > 0.075 || metrics.falseEdgeRatio.min > 0.04;
  const hasHaloEvidence = metrics.haloWidthPx.min > 2;
  const hasNoiseEvidence = metrics.noiseAmplificationRatio.min > 1.25;
  const hasMotionEvidence = fixture.generator.degradation.motionBlurPx > 0;
  const hasSaturationEvidence = fixture.generator.degradation.saturationFraction > 0.1;

  if (reasons.has('ringing_risk') && !hasRingingEvidence) {
    failures.push(`${fixture.fixtureId}: ringing rejection reason lacks ringing metric evidence.`);
  }
  if (reasons.has('halo_risk') && !hasHaloEvidence) {
    failures.push(`${fixture.fixtureId}: halo rejection reason lacks halo metric evidence.`);
  }
  if (reasons.has('noise_amplification_risk') && !hasNoiseEvidence) {
    failures.push(`${fixture.fixtureId}: noise rejection reason lacks noise amplification evidence.`);
  }
  if (reasons.has('motion_psf_unknown') && !hasMotionEvidence) {
    failures.push(`${fixture.fixtureId}: motion rejection reason lacks motion degradation evidence.`);
  }
  if (reasons.has('saturated_edge_risk') && !hasSaturationEvidence) {
    failures.push(`${fixture.fixtureId}: saturated-edge rejection reason lacks saturation evidence.`);
  }
}

if (failures.length > 0) {
  console.error('Deblur ringing validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated deblur ringing and halo thresholds for ${manifest.fixtures.length} fixtures.`);
