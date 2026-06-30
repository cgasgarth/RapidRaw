#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { estimateMaskRenderTileCount, parseMaskRenderScene } from '../../../src/schemas/maskRenderSchemas.ts';
import { renderFakeAiPeopleMask } from '../../../src/utils/aiPeopleMaskFakeProvider.ts';

const scenes = JSON.parse(readFileSync(resolve('fixtures/masks/ai/ai-people-render-scenes.json'), 'utf8'));
const fakeProviderFixture = JSON.parse(readFileSync(resolve('fixtures/masks/ai/ai-people-fake-provider.json'), 'utf8'));

let totalOperations = 0;
let totalTiles = 0;

for (const sceneValue of scenes) {
  const scene = parseMaskRenderScene(sceneValue);
  totalOperations += scene.maskOperations.length;
  totalTiles += estimateMaskRenderTileCount(scene);

  for (const operation of scene.maskOperations) {
    if (operation.type !== 'ai_people_fake') {
      continue;
    }

    const expectedMask = renderFakeAiPeopleMask(
      fakeProviderFixture.analysis,
      operation.peopleMask.target,
      operation.peopleMask.width,
      operation.peopleMask.height,
    );

    if (JSON.stringify(expectedMask) !== JSON.stringify(operation.peopleMask)) {
      console.error(`${operation.id}: render fixture people mask does not match fake provider output`);
      process.exit(1);
    }
  }
}

if (totalTiles !== 32) {
  console.error(`Expected 32 fake people render tiles, got ${totalTiles}.`);
  process.exit(1);
}

console.log(
  `Validated ${scenes.length} fake people render scenes, ${totalOperations} operations, and ${totalTiles} tiles.`,
);
