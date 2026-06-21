#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

const sidecarSchema = z
  .object({
    adjustments: z.unknown().nullable(),
    rating: z.number().int().min(0).max(5),
    tags: z.array(z.string().trim().min(1)).nullable(),
    version: z.literal(1),
  })
  .strict();

type Sidecar = z.infer<typeof sidecarSchema>;

const tempDir = await mkdtemp(join(tmpdir(), 'rawengine-virtual-copy-'));
const rawPath = join(tempDir, 'IMG_0001.CR3');
const originalSidecarPath = `${rawPath}.rrdata`;
const virtualSidecarPath = `${rawPath}.a1b2c3.rrdata`;

try {
  await writeFile(rawPath, 'private RAW fixture bytes stay immutable\n');
  await writeFile(
    originalSidecarPath,
    `${JSON.stringify(
      sidecarSchema.parse({
        adjustments: { exposure: 0.15, contrast: 0.05 },
        rating: 3,
        tags: ['user:original'],
        version: 1,
      }),
      null,
      2,
    )}\n`,
  );

  const rawHashBefore = await hashFile(rawPath);
  const originalHashBefore = await hashFile(originalSidecarPath);
  await copyFile(originalSidecarPath, virtualSidecarPath);

  const virtualCopy = sidecarSchema.parse(JSON.parse(await readFile(virtualSidecarPath, 'utf8'))) satisfies Sidecar;
  await writeFile(
    virtualSidecarPath,
    `${JSON.stringify(
      sidecarSchema.parse({
        ...virtualCopy,
        adjustments: { exposure: -0.3, contrast: 0.2, temperature: 4100 },
        rating: 5,
        tags: ['user:virtual-copy'],
      }),
      null,
      2,
    )}\n`,
  );

  assertEqual(await hashFile(rawPath), rawHashBefore, 'source RAW hash');
  assertEqual(await hashFile(originalSidecarPath), originalHashBefore, 'original sidecar hash');

  const originalReloaded = sidecarSchema.parse(JSON.parse(await readFile(originalSidecarPath, 'utf8')));
  const virtualReloaded = sidecarSchema.parse(JSON.parse(await readFile(virtualSidecarPath, 'utf8')));
  assertEqual(originalReloaded.rating, 3, 'original rating');
  assertEqual(virtualReloaded.rating, 5, 'virtual copy rating');

  console.log('virtual copy sidecar independence ok');
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}.`);
}
