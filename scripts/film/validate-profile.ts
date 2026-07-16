#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  filmAnalyticVectorSetV1Schema,
  filmNativeAnalyticReportV1Schema,
  filmNativeStochasticOpticalReportV1Schema,
  filmReleaseApprovalV1Schema,
  filmValidationFixtureV1Schema,
} from '../../packages/rawengine-schema/src/index.ts';
import {
  buildFilmOutputGamutReport,
  evaluateFilmBaselineApprovalGate,
  evaluateFilmNativeReleaseGate,
  evaluateFilmOutputGamutGate,
  evaluateFilmStochasticOpticalReleaseGate,
} from '../../src/utils/film-look/filmReleaseGate.ts';

const root = resolve(import.meta.dir, '../..');
const manifestPath = resolve(root, 'fixtures/film/validation/reference-film-validation-manifest-v1.json');
const approvalPath = resolve(root, 'fixtures/film/validation/reference-film-release-approval-v1.json');
const args = Bun.argv.slice(2);
const profile = args[args.indexOf('--profile') + 1];
const nativeProofReceiptIndex = args.indexOf('--native-proof-receipt-sha256');
const nativeProofReceiptSha256 = nativeProofReceiptIndex >= 0 ? args[nativeProofReceiptIndex + 1] : undefined;
const productionFilmPixelsChanged = args.includes('--production-film-pixels-changed');
if (profile !== 'rapidraw.reference_film.v1') throw new Error('Only the governed reference Film profile is available.');
if (!args.includes('--public-fixtures')) throw new Error('Refusing to run without --public-fixtures.');

const fixture = filmValidationFixtureV1Schema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const storedApproval = filmReleaseApprovalV1Schema.parse(JSON.parse(await readFile(approvalPath, 'utf8')));
const approval = filmReleaseApprovalV1Schema.parse({
  ...storedApproval,
  releasePolicy: {
    ...storedApproval.releasePolicy,
    nativeProofReceiptSha256: nativeProofReceiptSha256 ?? storedApproval.releasePolicy.nativeProofReceiptSha256,
    productionFilmPixelsChanged:
      productionFilmPixelsChanged || storedApproval.releasePolicy.productionFilmPixelsChanged,
  },
});
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
const stochasticOpticalMarker = stdout
  .split('\n')
  .find((line) => line.includes('FILM_NATIVE_STOCHASTIC_OPTICAL_REPORT='))
  ?.split('FILM_NATIVE_STOCHASTIC_OPTICAL_REPORT=')[1];
if (stochasticOpticalMarker === undefined)
  throw new Error('Native Film release gate did not emit stochastic/optical production evidence.');
const stochasticOpticalReport = filmNativeStochasticOpticalReportV1Schema.parse(JSON.parse(stochasticOpticalMarker));
const result = evaluateFilmNativeReleaseGate(fixture, vectors, nativeReport);
if (!result.passed) throw new Error(`Film release gate failed: ${result.failures.join(',')}`);
const stochasticOpticalResult = evaluateFilmStochasticOpticalReleaseGate(fixture, stochasticOpticalReport);
if (!stochasticOpticalResult.passed)
  throw new Error(`Film stochastic/optical release gate failed: ${stochasticOpticalResult.failures.join(',')}`);
const outputGamutReport = await buildFilmOutputGamutReport(fixture, nativeReport);
const outputGamutResult = evaluateFilmOutputGamutGate(fixture, nativeReport, outputGamutReport);
if (!outputGamutResult.passed)
  throw new Error(`Film output gamut gate failed: ${outputGamutResult.failures.join(',')}`);
const baselineResult = evaluateFilmBaselineApprovalGate(
  fixture,
  nativeReport,
  stochasticOpticalReport,
  outputGamutReport,
  approval,
);
if (!baselineResult.passed) throw new Error(`Film baseline approval gate failed: ${baselineResult.failures.join(',')}`);

console.error(
  `film release gate ok (${fixture.id}; ${String(nativeReport.samples.length)} vectors; colorimetric + sRGB/P3 gamut; production grain + optical subset; approved post-Film AP1)`,
);
console.log(
  JSON.stringify({
    contract: 'rapidraw.film_release_gate.v1',
    fixtureId: fixture.id,
    gamutClassifications: result.gamutClassifications,
    grainDensityVarianceRatio: stochasticOpticalResult.densityVarianceRatio,
    grainDeterministicHash: stochasticOpticalReport.grain.deterministicHash,
    maxIdentityDeltaE00: result.maxIdentityDeltaE00,
    maxReferenceDeltaE00: result.maxReferenceDeltaE00,
    previewExportMaxAbs: nativeReport.previewExportMaxAbs,
    previewExportRmse: nativeReport.previewExportRmse,
    outputGamutHashes: Object.fromEntries(
      outputGamutReport.targets.map(({ outputHash, target }) => [target, outputHash]),
    ),
    approvalCommit: approval.approval.approvalCommit,
    opticalSupportedSubset: stochasticOpticalReport.optical.supportedSubset,
    postFilmHash: nativeReport.deterministicHash,
    profile,
    sourceSha256: sourceHash,
    passed: true,
  }),
);
