#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  collectColorRuntimeProofFailures,
  colorRuntimeProofFixtureSchema,
  renderColorRuntimeProof,
} from '../../../scripts/lib/proofs/color-runtime-proof.ts';

const fixturePath = valueAfter('--fixture') ?? 'fixtures/color/white-balance-tone-runtime-proof.json';
const outputPath = valueAfter('--output');
const fixture = colorRuntimeProofFixtureSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')));
const artifact = renderColorRuntimeProof(fixture);
const failures = collectColorRuntimeProofFailures(fixture, artifact);

if (failures.length > 0) {
  console.error('White balance + tone runtime proof failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

if (outputPath !== undefined) {
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

console.log(
  `white balance + tone runtime proof ok (${artifact.changedPixels} changed, ${artifact.beforeHash.slice(
    7,
    19,
  )} -> ${artifact.afterHash.slice(7, 19)})`,
);

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
