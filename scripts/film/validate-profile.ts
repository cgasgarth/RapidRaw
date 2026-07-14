#!/usr/bin/env bun

import {
  createFilmAnalyticFixture,
  type FilmAnalyticVector,
  runFilmAnalyticConformance,
} from '../../src/utils/film-look/filmValidation.ts';

const args = Bun.argv.slice(2);
const profile = args[args.indexOf('--profile') + 1];
if (profile !== 'rapidraw.reference_film.v1') throw new Error('Only the governed reference Film profile is available.');
if (!args.includes('--public-fixtures')) throw new Error('Refusing to run without --public-fixtures.');

const fixture = createFilmAnalyticFixture();
const vectors: FilmAnalyticVector[] = [
  { id: 'neutral-gray', before: [0.18, 0.18, 0.18], after: [0.18, 0.18, 0.18] },
  { id: 'extended-range', before: [-0.1, 0.2, 1.2], after: [-0.1, 0.2, 1.2] },
  { id: 'highlight-ramp', before: [0.8, 0.7, 0.6], after: [0.80005, 0.70004, 0.60003] },
];
const report = await runFilmAnalyticConformance(fixture, vectors);
if (!report.passed) throw new Error(`Film release gate failed: ${report.failures.join(',')}`);
console.log(
  JSON.stringify({
    profile,
    fixtureId: report.fixtureId,
    postFilmDomain: report.postFilmDomain,
    passed: report.passed,
  }),
);
