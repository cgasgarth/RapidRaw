#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { z } from 'zod';

const ROOT = process.cwd();
const MANIFEST_PATH = 'docs/tooling/generated-type-drift-manifest.json';
const TAURI_SCHEMA_DIR = 'src-tauri/gen/schemas';
const DEFAULT_GENERATOR =
  'Tauri CLI generated capability schema snapshot; refresh after Tauri CLI/plugin changes with bun run check:generated-types -- --update.';

const GeneratedArtifactSchema = z
  .object({
    path: z.string().min(1),
    kind: z.literal('tauri-capability-schema'),
    generator: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const ManifestSchema = z
  .object({
    version: z.literal(1),
    artifacts: z.array(GeneratedArtifactSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set();

    manifest.artifacts.forEach((artifact, index) => {
      if (seen.has(artifact.path)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate generated artifact path: ${artifact.path}`,
          path: ['artifacts', index, 'path'],
        });
      }

      seen.add(artifact.path);
    });
  });

const normalizeRepoPath = (path) => path.split('/').join('/');
const toRepoPath = (absolutePath) => normalizeRepoPath(relative(ROOT, absolutePath));
const toAbsolutePath = (repoPath) => join(ROOT, repoPath);

const readJson = (repoPath) => JSON.parse(readFileSync(toAbsolutePath(repoPath), 'utf8'));

const hashFile = (repoPath) =>
  createHash('sha256')
    .update(readFileSync(toAbsolutePath(repoPath)))
    .digest('hex');

const listGeneratedArtifacts = () =>
  readdirSync(toAbsolutePath(TAURI_SCHEMA_DIR), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => toRepoPath(join(toAbsolutePath(TAURI_SCHEMA_DIR), entry.name)))
    .sort((a, b) => a.localeCompare(b));

const getExistingManifest = () => {
  if (!existsSync(toAbsolutePath(MANIFEST_PATH))) {
    return undefined;
  }

  return ManifestSchema.parse(readJson(MANIFEST_PATH));
};

const buildManifest = () => {
  const previousManifest = getExistingManifest();
  const previousArtifacts = new Map(previousManifest?.artifacts.map((artifact) => [artifact.path, artifact]));

  return {
    version: 1,
    artifacts: listGeneratedArtifacts().map((artifactPath) => ({
      path: artifactPath,
      kind: 'tauri-capability-schema',
      generator: previousArtifacts.get(artifactPath)?.generator ?? DEFAULT_GENERATOR,
      sha256: hashFile(artifactPath),
    })),
  };
};

const fail = (message, details = []) => {
  console.error(message);
  if (details.length > 0) {
    console.error(details.join('\n'));
  }
  process.exit(1);
};

const updateManifest = () => {
  const manifest = buildManifest();
  ManifestSchema.parse(manifest);
  mkdirSync(dirname(toAbsolutePath(MANIFEST_PATH)), { recursive: true });
  writeFileSync(toAbsolutePath(MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated ${MANIFEST_PATH} with ${manifest.artifacts.length} generated artifact hashes.`);
};

const checkManifest = () => {
  if (!existsSync(toAbsolutePath(MANIFEST_PATH))) {
    fail(`Missing generated type drift manifest: ${MANIFEST_PATH}`);
  }

  const manifest = getExistingManifest();
  const actualPaths = listGeneratedArtifacts();
  const expectedPaths = manifest.artifacts.map((artifact) => artifact.path);

  const pathFailures = [];
  for (const actualPath of actualPaths) {
    if (!expectedPaths.includes(actualPath)) {
      pathFailures.push(`${actualPath}: generated artifact is missing from ${MANIFEST_PATH}`);
    }
  }

  for (const expectedPath of expectedPaths) {
    if (!actualPaths.includes(expectedPath)) {
      pathFailures.push(`${expectedPath}: manifest entry no longer has a generated artifact on disk`);
    }
  }

  const sortedExpectedPaths = [...expectedPaths].sort((a, b) => a.localeCompare(b));
  if (expectedPaths.join('\n') !== sortedExpectedPaths.join('\n')) {
    pathFailures.push(`${MANIFEST_PATH}: artifacts must be sorted by path`);
  }

  if (pathFailures.length > 0) {
    fail('Generated type artifact inventory drift detected.', pathFailures);
  }

  const hashFailures = [];
  for (const artifact of manifest.artifacts) {
    const actualHash = hashFile(artifact.path);
    if (actualHash !== artifact.sha256) {
      hashFailures.push(`${artifact.path}: expected ${artifact.sha256}, got ${actualHash}`);
    }
  }

  if (hashFailures.length > 0) {
    fail(
      'Generated type artifact hash drift detected. Regenerate or intentionally refresh the manifest.',
      hashFailures,
    );
  }

  console.log(`Generated type drift check passed for ${manifest.artifacts.length} artifacts.`);
};

const args = new Set(process.argv.slice(2));

if (args.has('--update')) {
  updateManifest();
} else {
  checkManifest();
}
