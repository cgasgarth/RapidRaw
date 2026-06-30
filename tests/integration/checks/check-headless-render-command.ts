#!/usr/bin/env bun

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { headlessRenderArtifactSchema } from '../../../src/schemas/headlessRenderCommandSchemas.ts';

const tempDir = await mkdtemp(join(tmpdir(), 'rawengine-headless-render-'));
const outputPath = join(tempDir, 'artifact.json');

try {
  const success = Bun.spawnSync({
    cmd: [
      'bun',
      'scripts/dev/rawengine-headless-render.ts',
      '--request',
      'fixtures/validation/headless-render-command-request.json',
      '--output',
      outputPath,
    ],
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (!success.success) {
    throw new Error(`headless render command failed: ${success.stderr.toString().trim()}`);
  }

  const artifact = headlessRenderArtifactSchema.parse(JSON.parse(await readFile(outputPath, 'utf8')));
  if (artifact.changedPixels !== 4) {
    throw new Error(`Expected 4 changed pixels, got ${artifact.changedPixels}.`);
  }

  const failure = Bun.spawnSync({
    cmd: ['bun', 'scripts/dev/rawengine-headless-render.ts'],
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (failure.success || !failure.stderr.toString().includes('usage: bun scripts/dev/rawengine-headless-render.ts')) {
    throw new Error('Expected bounded usage failure for missing request.');
  }

  console.log(`headless render command ok (${artifact.changedPixels} changed)`);
} finally {
  await rm(tempDir, { force: true, recursive: true });
}
