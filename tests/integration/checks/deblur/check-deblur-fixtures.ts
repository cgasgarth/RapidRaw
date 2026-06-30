#!/usr/bin/env bun

import { expectInvalidCases, finishFixtureCheck, readJson } from '../../../../scripts/lib/fixtures/fixture-checks.ts';
import {
  deblurFixtureManifestSchema,
  parseDeblurFixtureManifest,
} from '../../../../src/schemas/deblurFixtureSchemas.ts';

const MANIFEST_PATH = 'fixtures/detail/deblur/deblur-fixtures.json';
const INVALID_PATH = 'fixtures/detail/invalid/deblur/invalid-deblur-fixtures.json';

const manifest = parseDeblurFixtureManifest(await readJson(MANIFEST_PATH));
const invalidCases = await readJson(INVALID_PATH);
const failures = [];

const acceptedFixtures = manifest.fixtures.filter((fixture) => fixture.acceptancePolicy.action === 'accept');
const rejectedFixtures = manifest.fixtures.filter((fixture) => fixture.acceptancePolicy.action === 'reject');

if (acceptedFixtures.length < 3) {
  failures.push('Expected at least three accepted Gaussian PSF fixtures.');
}

if (rejectedFixtures.length < 3) {
  failures.push('Expected at least three rejected failure guard fixtures.');
}

for (const fixture of acceptedFixtures) {
  if (fixture.generator.blur.type !== 'gaussian') {
    failures.push(`${fixture.fixtureId}: accepted v1 deblur fixtures must use constrained Gaussian PSF.`);
  }

  if (fixture.generator.degradation.motionBlurPx > 0 || fixture.generator.degradation.saturationFraction > 0.05) {
    failures.push(`${fixture.fixtureId}: accepted fixtures cannot hide motion or saturated-edge failure cases.`);
  }

  if (fixture.expectedMetrics.ringingOvershootRatio.max > 0.06) {
    failures.push(`${fixture.fixtureId}: accepted ringing overshoot max is too loose.`);
  }

  if (fixture.expectedMetrics.haloWidthPx.max > 1.75) {
    failures.push(`${fixture.fixtureId}: accepted halo width max is too loose.`);
  }

  if (fixture.expectedMetrics.noiseAmplificationRatio.max > 1.2) {
    failures.push(`${fixture.fixtureId}: accepted noise amplification max is too loose.`);
  }

  if (fixture.expectedMetrics.edgeAcutanceRatio.min < 1) {
    failures.push(`${fixture.fixtureId}: accepted edge acutance lower bound is too weak.`);
  }

  if (fixture.expectedMetrics.textureEnergyRatio.min < 0.65) {
    failures.push(`${fixture.fixtureId}: accepted texture energy lower bound is too weak.`);
  }
}

for (const fixture of manifest.fixtures) {
  if (fixture.sourceKind !== 'synthetic_public') {
    failures.push(`${fixture.fixtureId}: #1173 must stay synthetic-only; real RAW evidence belongs in #1182.`);
  }

  for (const artifact of fixture.artifacts) {
    if (artifact.path.startsWith('private-fixtures/') || artifact.path.startsWith('private-artifacts/')) {
      failures.push(`${fixture.fixtureId}: private artifact paths do not belong in the synthetic fixture contract.`);
    }
  }
}

for (const fixture of rejectedFixtures) {
  if (fixture.acceptancePolicy.rejectionReasons.length === 0) {
    failures.push(`${fixture.fixtureId}: rejected fixture needs at least one rejection reason.`);
  }

  const reasons = new Set(fixture.acceptancePolicy.rejectionReasons);
  if (reasons.has('noise_amplification_risk') && fixture.expectedMetrics.noiseAmplificationRatio.min <= 1.25) {
    failures.push(`${fixture.fixtureId}: noise amplification reject case does not exceed guard threshold.`);
  }
  if (reasons.has('ringing_risk') && fixture.expectedMetrics.ringingOvershootRatio.min <= 0.075) {
    failures.push(`${fixture.fixtureId}: ringing reject case does not exceed guard threshold.`);
  }
  if (reasons.has('halo_risk') && fixture.expectedMetrics.haloWidthPx.min <= 2) {
    failures.push(`${fixture.fixtureId}: halo reject case does not exceed guard threshold.`);
  }
}

expectInvalidCases({
  failures,
  getPayload: (invalidCase) => invalidCase.payload,
  invalidCases,
  label: 'deblur fixture manifest',
  schema: deblurFixtureManifestSchema,
});

finishFixtureCheck({
  failures,
  invalidCount: invalidCases.length,
  label: 'deblur fixtures',
  validCount: manifest.fixtures.length,
});
