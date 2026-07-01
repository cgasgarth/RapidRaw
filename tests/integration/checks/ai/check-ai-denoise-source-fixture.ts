#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

import {
  getPlannedPublicFixtureEntries,
  parsePublicFixtureManifest,
} from '../../../../src/schemas/publicFixtureManifestSchemas.ts';

const MANIFEST_PATH = 'docs/validation/fixtures/public-fixture-manifest.json';
const FIXTURE_ID = 'real.detail.high-iso-skin-shadow.v0';
const sourcePath = process.env.RAWENGINE_AI_DENOISE_SOURCE_PATH;

const manifest = parsePublicFixtureManifest(JSON.parse(await Bun.file(MANIFEST_PATH).text()));
const fixture = getPlannedPublicFixtureEntries(manifest).find((entry) => entry.fixtureId === FIXTURE_ID);

if (fixture === undefined) {
  console.error(`AI denoise source fixture failed: missing ${FIXTURE_ID}`);
  process.exit(1);
}

const failures: string[] = [];

if (fixture.status !== 'planned') failures.push(`${FIXTURE_ID}: must stay planned until #1267 has executable proof.`);
if (fixture.publicCiAllowed) failures.push(`${FIXTURE_ID}: public CI must stay disabled for uncommitted RAW assets.`);
if (!fixture.privateCiOnly) failures.push(`${FIXTURE_ID}: should stay private-CI-only before activation.`);
if (fixture.expectedSha256 === null) failures.push(`${FIXTURE_ID}: expected SHA-256 must be pinned.`);
if (fixture.expectedSizeBytes === null) failures.push(`${FIXTURE_ID}: expected byte size must be pinned.`);
if (!fixture.expectedWarnings.includes('no_committed_payload')) {
  failures.push(`${FIXTURE_ID}: expected warnings must record no committed payload.`);
}
if (fixture.sourceUrl === null || !fixture.sourceUrl.endsWith('.ARW')) {
  failures.push(`${FIXTURE_ID}: source URL must point to the candidate ARW asset.`);
}

if (failures.length > 0) {
  console.error(`AI denoise source fixture failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

if (sourcePath === undefined || sourcePath.trim().length === 0) {
  console.log(`ai denoise source fixture ok candidate=${FIXTURE_ID} localAsset=not-provided`);
  process.exit(0);
}

const expectedSha256 = fixture.expectedSha256;
const expectedSizeBytes = fixture.expectedSizeBytes;
if (expectedSha256 === null || expectedSizeBytes === null) {
  console.error(`AI denoise source fixture failed: ${FIXTURE_ID} is missing hash or size.`);
  process.exit(1);
}

const localFile = Bun.file(sourcePath);
const fileStat = await stat(sourcePath);
const hash = createHash('sha256')
  .update(Buffer.from(await localFile.arrayBuffer()))
  .digest('hex');

if (fileStat.size !== expectedSizeBytes) {
  console.error(`AI denoise source fixture failed: expected ${expectedSizeBytes} bytes, got ${fileStat.size}.`);
  process.exit(1);
}
if (hash !== expectedSha256) {
  console.error(`AI denoise source fixture failed: expected sha256 ${expectedSha256}, got ${hash}.`);
  process.exit(1);
}

console.log(`ai denoise source fixture ok bytes=${fileStat.size} sha256=${hash.slice(0, 12)}`);
