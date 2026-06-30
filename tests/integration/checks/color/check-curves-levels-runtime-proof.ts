#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  collectCurvesLevelsRuntimeProofFailures,
  curvesLevelsRuntimeProofFixtureSchema,
  renderCurvesLevelsRuntimeProof,
} from '../../../../scripts/lib/proofs/curves-levels-runtime-proof.ts';

const fixturePath = valueAfter('--fixture') ?? 'fixtures/color/proofs/curves-levels-runtime-proof.json';
const outputPath = valueAfter('--output');
const updateFixture = process.argv.includes('--update');
const rawFixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const fixture = curvesLevelsRuntimeProofFixtureSchema.parse(
  updateFixture ? { ...rawFixture, expected: placeholderExpected(rawFixture.sourcePixels) } : rawFixture,
);

const artifact = renderCurvesLevelsRuntimeProof(fixture);

if (updateFixture) {
  const nextFixture = curvesLevelsRuntimeProofFixtureSchema.parse({
    ...rawFixture,
    expected: artifactToExpected(artifact),
  });
  await writeFile(fixturePath, `${JSON.stringify(nextFixture, null, 2)}\n`);
  process.exit(0);
}

const failures = collectCurvesLevelsRuntimeProofFailures(fixture, artifact);

if (failures.length > 0) {
  console.error('Curves + levels runtime proof failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

if (outputPath !== undefined) {
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

console.log(
  `curves + levels runtime proof ok (${artifact.changedPixels} changed, ${artifact.beforeHash.slice(
    7,
    19,
  )} -> ${artifact.afterHash.slice(7, 19)})`,
);

function artifactToExpected(artifact: ReturnType<typeof renderCurvesLevelsRuntimeProof>) {
  return {
    afterHash: artifact.afterHash,
    beforeHash: artifact.beforeHash,
    changedPixels: artifact.changedPixels,
    curveChangedPixels: artifact.curveChangedPixels,
    levelsChangedPixels: artifact.levelsChangedPixels,
    levelsHash: artifact.levelsHash,
    outputPixels: artifact.outputPixels,
  };
}

function placeholderExpected(sourcePixels: unknown) {
  return {
    afterHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    beforeHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    changedPixels: 1,
    curveChangedPixels: 1,
    levelsChangedPixels: 1,
    levelsHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    outputPixels: sourcePixels,
  };
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
