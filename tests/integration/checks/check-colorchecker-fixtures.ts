#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  listActiveColorCheckerAssets,
  parseColorCheckerFixtureManifest,
} from '../../../src/utils/colorCheckerFixtures.ts';

const manifestPath = resolve('fixtures/color/reference/colorchecker-fixture-manifest.json');
const manifestJson: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
const manifest = parseColorCheckerFixtureManifest(manifestJson);

const activeAssets = listActiveColorCheckerAssets(manifest);
if (activeAssets.length > 0) {
  throw new Error('ColorChecker fixtures are metadata-only until real asset provenance and hashes are added.');
}

console.log(`Validated ${manifest.fixtures.length} ColorChecker fixture definitions.`);
