#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  filterSmartAlbumAssets,
  parseSmartAlbumAssets,
  parseSmartAlbumCatalog,
  smartAlbumCatalogSchema,
} from '../../../src/schemas/library/smartAlbumFilterSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const catalog = parseSmartAlbumCatalog(await readJson('fixtures/library/smart-albums.json'));
const assets = parseSmartAlbumAssets(await readJson('fixtures/library/smart-album-assets.json'));
const invalidCases = await readJson('fixtures/library/invalid-smart-album-cases.json');
const failures = [];

const expectedMatches = new Map([
  [
    'smart-portfolio-raw-picks',
    ['/Users/example/Pictures/Portfolio/DSC_0001.NEF', '/Users/example/Pictures/Portfolio/DSC_0002.ARW'],
  ],
  [
    'smart-green-or-edited',
    ['/Users/example/Pictures/Portfolio/DSC_0001.NEF', '/Users/example/Pictures/Portfolio/DSC_0003-copy.JPG'],
  ],
]);

for (const album of catalog.albums) {
  const actualPaths = filterSmartAlbumAssets(album, assets).map((asset) => asset.path);
  const expectedPaths = expectedMatches.get(album.id) ?? [];
  if (actualPaths.join('\n') !== expectedPaths.join('\n')) {
    failures.push(`${album.id} matched ${JSON.stringify(actualPaths)} instead of ${JSON.stringify(expectedPaths)}.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = smartAlbumCatalogSchema.safeParse(invalidCase.catalog);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

if (failures.length > 0) {
  console.error('Smart album fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${catalog.albums.length} smart albums against ${assets.length} assets and ${invalidCases.length} invalid cases.`,
);
