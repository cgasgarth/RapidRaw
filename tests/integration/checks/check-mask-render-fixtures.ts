#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  estimateMaskRenderTileCount,
  maskRenderSceneSchema,
  parseMaskRenderScene,
} from '../../../src/schemas/maskRenderSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const scenes = await readJson('fixtures/masks/render/mask-render-scenes.json');
const invalidCases = await readJson('fixtures/masks/invalid/invalid-mask-render-scenes.json');
const failures = [];

let totalLayers = 0;
let totalOperations = 0;
let totalTiles = 0;

for (const sceneValue of scenes) {
  const scene = parseMaskRenderScene(sceneValue);
  totalLayers += scene.layers.length;
  totalOperations += scene.maskOperations.length;
  totalTiles += estimateMaskRenderTileCount(scene);

  const referencedOperationIds = new Set(scene.layers.flatMap((layer) => layer.maskOperationIds));
  if (referencedOperationIds.size !== scene.maskOperations.length) {
    failures.push(
      `Scene references ${referencedOperationIds.size} operations but defines ${scene.maskOperations.length}.`,
    );
  }
}

for (const invalidCase of invalidCases) {
  const result = maskRenderSceneSchema.safeParse(invalidCase.scene);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed.`);
  }
}

if (totalTiles !== 379) {
  failures.push(`Expected 379 mask render tiles across fixtures, got ${totalTiles}.`);
}

if (failures.length > 0) {
  console.error('Mask render fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${scenes.length} mask render scenes, ${totalLayers} layers, ${totalOperations} operations, ${totalTiles} render tiles, and ${invalidCases.length} invalid cases.`,
);
