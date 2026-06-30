#!/usr/bin/env bun

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { negativeLabFixtureManifestV1Schema } from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const repoRoot = new URL('../../..', import.meta.url).pathname;
const manifestUrl = new URL(
  '../../../../fixtures/negative-lab/negative-lab-real-fixture-manifest.json',
  import.meta.url,
);
const manifest = negativeLabFixtureManifestV1Schema.parse(JSON.parse(await readFile(manifestUrl, 'utf8')));

const scanRoots = ['src/utils', 'src-tauri/src', 'packages/rawengine-schema/src'];
const scanFiles = ['fixtures/negative-lab/negative-lab-real-fixture-manifest.json'];
const disallowedArtifactPatterns = [
  /github\.com\/marcinz606\/negpy/iu,
  /\bgnu general public license\b/iu,
  /\bgpl[- ]?3\b/iu,
  /\bnegpy\b(?! concepts only)/iu,
  /negative\s+lab\s+pro\b.*(?:matrix|curve|profile|preset|constant)/iu,
  /\bnlp\b.*(?:matrix|curve|profile|preset|constant)/iu,
];
const allowedTextFragments = [
  'NegPy concepts only',
  'negPyArtifactUse',
  'Negative Lab clean-room provenance',
  'NegPy as concepts-only inspiration',
  'Generic Negative Lab preset',
  'Negative Lab fixture',
  'Negative Lab fixtures',
  'Negative Lab render',
  'Negative Lab promotion',
];

const walk = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (/\.(?:json|rs|ts|tsx)$/u.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
};

for (const entry of manifest.entries) {
  if (
    entry.cleanRoomProvenance.cleanRoomPolicy !== 'rawengine_owned_clean_room_v1' ||
    entry.cleanRoomProvenance.implementationOwner !== 'RawEngine project' ||
    entry.cleanRoomProvenance.negPyArtifactUse !== 'none' ||
    entry.cleanRoomProvenance.thirdPartyCodeCopied ||
    entry.cleanRoomProvenance.thirdPartyConstantsCopied ||
    entry.cleanRoomProvenance.thirdPartyDocsCopied ||
    entry.cleanRoomProvenance.thirdPartyTestVectorsCopied
  ) {
    throw new Error(`Real Negative Lab fixture lacks clean-room provenance: ${entry.fixtureId}`);
  }

  if (entry.payloadAccess === 'metadata_only' && entry.allowedDistribution !== 'none') {
    throw new Error(`Metadata-only fixture must not allow distribution: ${entry.fixtureId}`);
  }

  if (
    entry.allowedDistribution === 'public_repo' &&
    (entry.source.licenseName === undefined ||
      entry.source.sourceUrl === undefined ||
      entry.source.redistributionEvidence === undefined)
  ) {
    throw new Error(`Public fixture must include license, source URL, and redistribution evidence: ${entry.fixtureId}`);
  }
}

const scannedFiles = [
  ...scanFiles.map((path) => join(repoRoot, path)),
  ...(await Promise.all(scanRoots.map((root) => walk(join(repoRoot, root))))).flat(),
];
for (const path of scannedFiles) {
  const text = await readFile(path, 'utf8');
  const searchableText = allowedTextFragments.reduce(
    (currentText, fragment) => currentText.replaceAll(fragment, ''),
    text,
  );

  for (const pattern of disallowedArtifactPatterns) {
    if (pattern.test(searchableText)) {
      throw new Error(`Negative Lab v2 clean-room hygiene failed in ${relative(repoRoot, path)}: ${pattern}`);
    }
  }
}

console.log(`negative lab final license hygiene ok (${manifest.entries.length} real fixture entries)`);
