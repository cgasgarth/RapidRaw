#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { z } from 'zod';

import { parseLibraryBackupManifest, type LibraryBackupFileEntry } from '../../../src/schemas/libraryBackupSchemas.ts';
import { parseLibrarySessionSet } from '../../../src/schemas/librarySessionSchemas.ts';
import { buildLibraryBackupManifest, verifyLibraryBackupRestore } from '../../../src/utils/libraryBackupManifest.ts';

const sourceManifestPath = 'fixtures/workflow/session-import-reload-proof.json';
const backupRoot = 'artifacts/workflow/library-backup-restore-proof';
const backupFilesRoot = join(backupRoot, 'files');
const backupManifestPath = join(backupRoot, 'library-backup-manifest.json');
const restoredRoot = join(backupRoot, 'restored');

const sourceProofSchema = z
  .object({
    importedAssets: z
      .array(
        z
          .object({
            sidecarPath: z.string().trim().min(1),
            sourcePath: z.string().trim().min(1),
          })
          .passthrough(),
      )
      .min(1),
    sessionFixturePath: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .passthrough();

const sourceProof = sourceProofSchema.parse(JSON.parse(await readFile(sourceManifestPath, 'utf8')));
const sessionSet = parseLibrarySessionSet(JSON.parse(await readFile(sourceProof.sessionFixturePath, 'utf8')));
const session = sessionSet.sessions.find((candidate) => candidate.id === sourceProof.sessionId);
if (!session) {
  throw new Error(`${sourceProof.sessionId}: source session missing.`);
}

await rm(backupRoot, { force: true, recursive: true });
await mkdir(backupFilesRoot, { recursive: true });
await mkdir(restoredRoot, { recursive: true });

const sourceFiles = [
  { path: sourceProof.sessionFixturePath, role: 'library_session' },
  ...sourceProof.importedAssets.map((asset) => ({ path: asset.sidecarPath, role: 'sidecar_rrdata' })),
] as const;

const fileEntries: LibraryBackupFileEntry[] = [];
for (const sourceFile of sourceFiles) {
  const destinationPath = join(backupFilesRoot, basename(sourceFile.path));
  await copyFile(sourceFile.path, destinationPath);
  fileEntries.push({
    byteLength: (await stat(destinationPath)).size,
    contentHash: await hashFile(destinationPath),
    originalPath: sourceFile.path,
    restoredPath: join(restoredRoot, basename(sourceFile.path)),
    role: sourceFile.role,
  });
}

const manifest = buildLibraryBackupManifest({
  backupId: 'library-backup-proof-session-wedding-cull',
  createdAt: '2026-06-23T02:35:00.000Z',
  excludedOriginalPaths: session.recentAssetPaths,
  files: fileEntries,
  includeOriginals: false,
  manifestHash: hashText(JSON.stringify(fileEntries)),
  sessionId: sourceProof.sessionId,
  sessionSet,
  sourceSessionHash: hashText(JSON.stringify(session)),
});

await writeFile(backupManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const reloadedManifest = parseLibraryBackupManifest(JSON.parse(await readFile(backupManifestPath, 'utf8')));

const restoredFiles: LibraryBackupFileEntry[] = [];
for (const manifestFile of reloadedManifest.files) {
  if (!manifestFile.restoredPath) {
    throw new Error(`${manifestFile.originalPath}: missing restore target.`);
  }
  const backupPath = join(backupFilesRoot, basename(manifestFile.originalPath));
  await copyFile(backupPath, manifestFile.restoredPath);
  restoredFiles.push({
    ...manifestFile,
    byteLength: (await stat(manifestFile.restoredPath)).size,
    contentHash: await hashFile(manifestFile.restoredPath),
  });
}

const restoredSessionSet = parseLibrarySessionSet(
  JSON.parse(await readFile(join(restoredRoot, basename(sourceProof.sessionFixturePath)), 'utf8')),
);
verifyLibraryBackupRestore({
  manifest: reloadedManifest,
  restoredFiles,
  restoredSessionSet,
});

if (reloadedManifest.excludedOriginalPaths.length !== session.recentAssetPaths.length) {
  throw new Error('Backup manifest must record excluded originals when includeOriginals=false.');
}

console.log(`library backup/restore proof ok (${reloadedManifest.fileCount} files)`);

async function hashFile(path: string): Promise<string> {
  return hashText(await readFile(path));
}

function hashText(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}
