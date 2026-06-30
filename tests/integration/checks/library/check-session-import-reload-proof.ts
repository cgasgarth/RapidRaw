#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import { parseLibrarySessionSet } from '../../../../src/schemas/librarySessionSchemas.ts';
import { buildLibrarySessionWorkflowPlan } from '../../../../src/schemas/librarySessionUiSchemas.ts';

const manifestPath = 'fixtures/workflow/session-import-reload-proof.json';

const pathSchema = z.string().trim().min(1);
const sidecarMetadataSchema = z
  .object({
    rating: z.number().int().min(0).max(5),
    tags: z.array(z.string().trim().min(1)),
    version: z.literal(1),
  })
  .passthrough();
const importedAssetSchema = z
  .object({
    expectedRating: z.number().int().min(0).max(5),
    expectedTags: z.array(z.string().trim().min(1)),
    sidecarPath: pathSchema,
    sourcePath: pathSchema,
  })
  .strict();
const manifestSchema = z
  .object({
    artifactPath: pathSchema,
    importedAssets: z.array(importedAssetSchema).min(1),
    schemaVersion: z.literal(1),
    sessionFixturePath: pathSchema,
    sessionId: pathSchema,
  })
  .strict();
const persistedAssetSchema = importedAssetSchema
  .extend({
    sidecarHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
const persistedProofSchema = z
  .object({
    importedAssets: z.array(persistedAssetSchema).min(1),
    session: z.object({
      activeSessionId: pathSchema,
      id: pathSchema,
      recentAssetPaths: z.array(pathSchema).min(1),
      selectedAssetPaths: z.array(pathSchema).min(1),
      workflowPlan: z.object({
        canExportSelection: z.literal(true),
        nextAction: z.literal('review_selection'),
        selectedCount: z.number().int().min(1),
      }),
    }),
    sessionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    sourceManifest: pathSchema,
  })
  .strict();

const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const sessionSet = parseLibrarySessionSet(JSON.parse(await readFile(manifest.sessionFixturePath, 'utf8')));
const session = sessionSet.sessions.find((candidate) => candidate.id === manifest.sessionId);
const failures: string[] = [];

if (session === undefined) {
  failures.push(`${manifest.sessionId}: session missing.`);
} else {
  const persistedAssets = [];
  for (const asset of manifest.importedAssets) {
    if (!session.recentAssetPaths.includes(asset.sourcePath)) {
      failures.push(`${asset.sourcePath}: missing from recent assets.`);
    }
    if (!session.selectedAssetPaths.includes(asset.sourcePath)) {
      failures.push(`${asset.sourcePath}: missing from selected assets.`);
    }

    const sidecar = sidecarMetadataSchema.parse(JSON.parse(await readFile(asset.sidecarPath, 'utf8')));
    if (sidecar.rating !== asset.expectedRating) {
      failures.push(`${asset.sidecarPath}: rating drift.`);
    }
    if (JSON.stringify(sidecar.tags) !== JSON.stringify(asset.expectedTags)) {
      failures.push(`${asset.sidecarPath}: tags drift.`);
    }

    persistedAssets.push({ ...asset, sidecarHash: await hashFile(asset.sidecarPath) });
  }

  const persistedProof = persistedProofSchema.parse({
    importedAssets: persistedAssets,
    session: {
      activeSessionId: sessionSet.activeSessionId,
      id: session.id,
      recentAssetPaths: session.recentAssetPaths,
      selectedAssetPaths: session.selectedAssetPaths,
      workflowPlan: buildLibrarySessionWorkflowPlan(session),
    },
    sessionHash: hashText(JSON.stringify(session)),
    sourceManifest: manifestPath,
  });

  await mkdir(dirname(manifest.artifactPath), { recursive: true });
  await writeFile(manifest.artifactPath, `${JSON.stringify(persistedProof, null, 2)}\n`);
  const reloadedProof = persistedProofSchema.parse(JSON.parse(await readFile(manifest.artifactPath, 'utf8')));

  assertSame(reloadedProof.session.id, persistedProof.session.id, 'session id');
  assertSame(reloadedProof.sessionHash, persistedProof.sessionHash, 'session hash');
  assertSame(
    JSON.stringify(reloadedProof.session.selectedAssetPaths),
    JSON.stringify(persistedProof.session.selectedAssetPaths),
    'selection',
  );
  assertSame(JSON.stringify(reloadedProof.importedAssets), JSON.stringify(persistedProof.importedAssets), 'metadata');
}

if (failures.length > 0) {
  console.error('Session import/reload proof failed.');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log(`session import/reload proof ok (${manifest.importedAssets.length} assets)`);

async function hashFile(path: string): Promise<string> {
  return hashText(await readFile(path, 'utf8'));
}

function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function assertSame(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} changed after reload.`);
  }
}
