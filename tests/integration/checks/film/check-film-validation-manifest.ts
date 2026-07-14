#!/usr/bin/env bun

import { filmValidationFixtureV1Schema } from '../../../../packages/rawengine-schema/src/index.ts';
import { classifyLinearRgbGamut } from '../../../../src/utils/color/runtime/gamutMappingRuntime.ts';
import { calculateDeltaE00 } from '../../../../src/utils/deltaE00.ts';
import {
  createFilmAnalyticFixture,
  type FilmAnalyticVector,
  runFilmAnalyticConformance,
} from '../../../../src/utils/film-look/filmValidation.ts';

const fixture = createFilmAnalyticFixture();
const vectors: FilmAnalyticVector[] = [
  { id: 'neutral-gray', before: [0.18, 0.18, 0.18], after: [0.18, 0.18, 0.18] },
  { id: 'extended-range', before: [-0.1, 0.2, 1.2], after: [-0.1, 0.2, 1.2] },
  { id: 'highlight-ramp', before: [0.8, 0.7, 0.6], after: [0.80005, 0.70004, 0.60003] },
];
const report = await runFilmAnalyticConformance(fixture, vectors);
const repeat = await runFilmAnalyticConformance(fixture, vectors);
if (!report.passed || report.failures.length > 0)
  throw new Error(`Analytic Film gate failed: ${report.failures.join(',')}`);
if (report.deterministicHash !== repeat.deterministicHash)
  throw new Error('Analytic report hash is not deterministic.');
if (
  report.postFilmDomain !== 'acescg_linear_v1' ||
  report.negativeComponentCount !== 1 ||
  report.highComponentCount !== 1
)
  throw new Error('Post-Film AP1 range accounting is incorrect.');
if (classifyLinearRgbGamut(vectors[1].after) !== 'mixed_out_of_gamut')
  throw new Error('Gamut classification was not reused.');
if (calculateDeltaE00({ l: 50, a: 0, b: 0 }, { l: 50, a: 0, b: 0 }) !== 0)
  throw new Error('Existing DeltaE00 oracle did not remain usable.');

const privateAsPublic = {
  ...fixture,
  proofLevel: 'public_runtime_fixture' as const,
  source: { ...fixture.source, publicRepoAllowed: false },
};
if (filmValidationFixtureV1Schema.safeParse(privateAsPublic).success)
  throw new Error('Private fixture was accepted as a public runtime fixture.');

console.log(`film validation manifest ok (${report.fixtureId}, deterministic analytic gate passed)`);
