#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  filmAnalyticVectorSetV1Schema,
  filmNativeAnalyticReportV1Schema,
  filmValidationFixtureV1Schema,
} from '../../packages/rawengine-schema/src/index.ts';
import { evaluateFilmNativeReleaseGate } from '../../src/utils/film-look/filmReleaseGate.ts';

const root = resolve(import.meta.dir, '../..');
const manifestPath = resolve(root, 'fixtures/film/validation/reference-film-validation-manifest-v1.json');
const args = Bun.argv.slice(2);
const profile = args[args.indexOf('--profile') + 1];
if (profile !== 'rapidraw.reference_film.v1') throw new Error('Only the governed reference Film profile is available.');
if (!args.includes('--public-fixtures')) throw new Error('Refusing to run without --public-fixtures.');

const fixture = filmValidationFixtureV1Schema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
if (!fixture.source.publicRepoAllowed || fixture.proofLevel !== 'analytic_numeric')
  throw new Error('Film release gate requires a public analytic fixture.');
const vectorPath = resolve(root, fixture.source.pathOrPrivateRef);
const vectorBytes = await readFile(vectorPath);
const vectors = filmAnalyticVectorSetV1Schema.parse(JSON.parse(vectorBytes.toString('utf8')));
const sourceHash = `sha256:${new Bun.CryptoHasher('sha256').update(vectorBytes).digest('hex')}`;
if (sourceHash !== fixture.source.sha256) throw new Error('Film analytic source hash does not match its manifest.');
if (JSON.stringify(vectors.profileRef) !== JSON.stringify(fixture.render.profileRefs[0]))
  throw new Error('Film analytic vectors do not match the manifest profile identity.');

const command = [
  'bun',
  'scripts/ci/run-resource-coordinated.ts',
  '--resource',
  'native-heavy',
  '--label',
  'film-release-gate',
  '--',
  'cargo',
  'test',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  '--features',
  'required-ci',
  'reference_profile_release_gate',
  '--',
  '--nocapture',
];
const native = Bun.spawn(command, { cwd: root, stderr: 'pipe', stdout: 'pipe' });
const [exitCode, stdout, stderr] = await Promise.all([
  native.exited,
  new Response(native.stdout).text(),
  new Response(native.stderr).text(),
]);
if (exitCode !== 0) {
  const excerpt = `${stdout}\n${stderr}`.trim().split('\n').slice(-30).join('\n');
  throw new Error(`Native Film release gate failed (exit ${String(exitCode)}):\n${excerpt}`);
}
const marker = stdout
  .split('\n')
  .find((line) => line.includes('FILM_NATIVE_ANALYTIC_REPORT='))
  ?.split('FILM_NATIVE_ANALYTIC_REPORT=')[1];
if (marker === undefined) throw new Error('Native Film release gate did not emit its governed report.');
const nativeReport = filmNativeAnalyticReportV1Schema.parse(JSON.parse(marker));
const result = evaluateFilmNativeReleaseGate(fixture, nativeReport);
if (!result.passed) throw new Error(`Film release gate failed: ${result.failures.join(',')}`);

console.error(
  `film release gate ok (${fixture.id}; ${String(nativeReport.samples.length)} production vectors; post-Film AP1)`,
);
console.log(
  JSON.stringify({
    contract: 'rapidraw.film_release_gate.v1',
    fixtureId: fixture.id,
    gamutClassifications: result.gamutClassifications,
    maxIdentityDeltaE00: result.maxIdentityDeltaE00,
    postFilmHash: nativeReport.deterministicHash,
    profile,
    sourceSha256: sourceHash,
    passed: true,
  }),
);
