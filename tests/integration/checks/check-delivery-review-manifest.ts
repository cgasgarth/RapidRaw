#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseExportRecipes } from '../../../src/schemas/exportRecipeSchemas.ts';
import { parseLibrarySessionSet } from '../../../src/schemas/librarySessionSchemas.ts';

const manifestPath = 'fixtures/workflow/delivery-review-manifest.json';
const pathSchema = z.string().trim().min(1);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const deliveryReviewManifestSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    manifestId: z.string().trim().min(1),
    reviewArtifactLinks: z
      .array(
        z
          .object({
            kind: z.enum(['agent_replay_gallery', 'runtime_completion_states']),
            path: pathSchema,
          })
          .strict(),
      )
      .min(1),
    schemaVersion: z.literal(1),
    selectedOutputs: z
      .array(
        z
          .object({
            outputPath: pathSchema,
            recipeId: pathSchema,
            sidecarPath: pathSchema,
            sidecarSha256: sha256Schema,
            sourcePath: pathSchema,
            status: z.literal('ready_for_review'),
          })
          .strict(),
      )
      .min(1),
    sessionFixturePath: pathSchema,
    sessionId: pathSchema,
    sourceRecipeFixturePath: pathSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const sourcePaths = new Set<string>();
    const outputPaths = new Set<string>();
    for (const [index, output] of manifest.selectedOutputs.entries()) {
      if (sourcePaths.has(output.sourcePath)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate sourcePath: ${output.sourcePath}`,
          path: ['selectedOutputs', index],
        });
      }
      if (outputPaths.has(output.outputPath)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate outputPath: ${output.outputPath}`,
          path: ['selectedOutputs', index],
        });
      }
      sourcePaths.add(output.sourcePath);
      outputPaths.add(output.outputPath);
    }
  });

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

const hashFile = async (path: string): Promise<string> =>
  `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;

const manifest = deliveryReviewManifestSchema.parse(await readJson(manifestPath));
const sessionSet = parseLibrarySessionSet(await readJson(manifest.sessionFixturePath));
const recipes = parseExportRecipes(await readJson(manifest.sourceRecipeFixturePath));
const failures: string[] = [];
const session = sessionSet.sessions.find((candidate) => candidate.id === manifest.sessionId);

if (session === undefined) {
  failures.push(`${manifest.sessionId}: session not found.`);
} else {
  const manifestSources = manifest.selectedOutputs.map((output) => output.sourcePath).sort();
  const sessionSources = [...session.selectedAssetPaths].sort();
  if (JSON.stringify(manifestSources) !== JSON.stringify(sessionSources)) {
    failures.push(`${manifest.sessionId}: selected outputs must match session selection.`);
  }

  const recipeIds = new Set(recipes.map((recipe) => recipe.id));
  for (const output of manifest.selectedOutputs) {
    if (!session.exportRecipeIds.includes(output.recipeId)) {
      failures.push(`${output.sourcePath}: recipe is not attached to session.`);
    }
    if (!recipeIds.has(output.recipeId)) {
      failures.push(`${output.recipeId}: recipe fixture missing.`);
    }
  }
}

for (const link of manifest.reviewArtifactLinks) {
  await access(link.path).catch(() => {
    failures.push(`${link.path}: review artifact link missing.`);
  });
}

for (const output of manifest.selectedOutputs) {
  const actualHash = await hashFile(output.sidecarPath);
  if (actualHash !== output.sidecarSha256) {
    failures.push(`${output.sidecarPath}: sidecar hash drift.`);
  }
}

if (failures.length > 0) {
  console.error('Delivery review manifest validation failed.');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log(`delivery review manifest ok (${manifest.selectedOutputs.length} outputs)`);
