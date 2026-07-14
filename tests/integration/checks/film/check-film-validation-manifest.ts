#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  filmAnalyticVectorSetV1Schema,
  filmValidationFixtureV1Schema,
} from '../../../../packages/rawengine-schema/src/index.ts';

const root = resolve(import.meta.dir, '../../../..');
const manifestPath = resolve(root, 'fixtures/film/validation/reference-film-validation-manifest-v1.json');
const manifest = filmValidationFixtureV1Schema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const sourcePath = resolve(root, manifest.source.pathOrPrivateRef);
const sourceBytes = await readFile(sourcePath);
const vectors = filmAnalyticVectorSetV1Schema.parse(JSON.parse(sourceBytes.toString('utf8')));
const sourceHash = `sha256:${new Bun.CryptoHasher('sha256').update(sourceBytes).digest('hex')}`;
if (sourceHash !== manifest.source.sha256) throw new Error('Governed Film source hash drifted.');
if (JSON.stringify(vectors.profileRef) !== JSON.stringify(manifest.render.profileRefs[0]))
  throw new Error('Governed Film profile identity drifted between manifest and vectors.');

const privateAsPublic = {
  ...manifest,
  proofLevel: 'public_runtime_fixture' as const,
  source: { ...manifest.source, publicRepoAllowed: false },
};
if (filmValidationFixtureV1Schema.safeParse(privateAsPublic).success)
  throw new Error('Private fixture was accepted as a public runtime fixture.');
const ambiguousInputTransform = { ...manifest, input: { ...manifest.input, inputTransformId: '' } };
if (filmValidationFixtureV1Schema.safeParse(ambiguousInputTransform).success)
  throw new Error('Manifest accepted a missing input-transform identity.');
const nonMonotoneVectors = {
  ...vectors,
  neutralRamp: { ...vectors.neutralRamp, values: [0, 0.18, 0.1, 1, 2] },
};
if (filmAnalyticVectorSetV1Schema.safeParse(nonMonotoneVectors).success)
  throw new Error('Analytic source accepted a non-monotone neutral ramp.');

console.log(`film validation manifest ok (${manifest.id}, ${String(vectors.samples.length)} production vectors)`);
