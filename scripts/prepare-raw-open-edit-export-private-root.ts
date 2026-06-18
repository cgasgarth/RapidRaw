#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, rm, symlink, copyFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { parsePrivateRawEvidenceLedger } from '../src/schemas/privateRawEvidenceSchemas.ts';
import { rawOpenEditExportProofRequestSchema } from '../src/schemas/rawOpenEditExportCommandSchemas.ts';
import { parseRawOpenEditExportProofManifest } from '../src/schemas/rawOpenEditExportProofSchemas.ts';

const args = new Set(process.argv.slice(2));
const copyMode = args.has('--copy');
const requireAssets = args.has('--require-assets');

const requestJson: unknown = JSON.parse(
  await readFile('fixtures/validation/raw-open-edit-export-proof-request.json', 'utf8'),
);
const proofJson: unknown = JSON.parse(await readFile('fixtures/validation/raw-open-edit-export-proof.json', 'utf8'));
const ledgerJson: unknown = JSON.parse(await readFile('fixtures/detail/private-raw-evidence-ledger.json', 'utf8'));

const request = rawOpenEditExportProofRequestSchema.parse(requestJson);
const proof = parseRawOpenEditExportProofManifest(proofJson);
const ledger = parsePrivateRawEvidenceLedger(ledgerJson);

const proofCase = proof.proofCases.find((candidate) => candidate.fixtureId === request.fixtureId);
if (proofCase === undefined) {
  fail(`${request.fixtureId}: missing RAW open/edit/export proof case.`);
}

const ledgerEntry = ledger.entries.find((entry) => entry.evidenceId === proofCase.evidenceId);
if (ledgerEntry === undefined) {
  fail(`${proofCase.evidenceId}: missing private RAW evidence ledger entry.`);
}
if (ledgerEntry.localRelativePath === undefined || ledgerEntry.fileSha256 === undefined) {
  fail(`${ledgerEntry.evidenceId}: available source path and hash are required.`);
}
if (!isAbsolute(request.privateRootPath)) {
  fail('privateRootPath must be absolute.');
}

const sourcePath = resolve(ledgerEntry.localRelativePath);
const sourceExists = await pathExists(sourcePath);
if (!sourceExists) {
  const message = `${ledgerEntry.evidenceId}: missing local source ${ledgerEntry.localRelativePath}`;
  if (requireAssets) fail(message);
  console.log(`raw open/edit/export private root skipped (${message})`);
  process.exit(0);
}

const sourceHash = `sha256:${createHash('sha256')
  .update(await readFile(sourcePath))
  .digest('hex')}`;
if (sourceHash !== ledgerEntry.fileSha256) {
  fail(`${ledgerEntry.evidenceId}: expected ${ledgerEntry.fileSha256}, got ${sourceHash}.`);
}

const linkedPaths = [request.sourceRelativePath, ledgerEntry.localRelativePath];
for (const relativePath of linkedPaths) {
  const targetPath = resolvePrivatePath(request.privateRootPath, relativePath);
  await linkOrCopy(sourcePath, targetPath);
}
await mkdir(resolvePrivatePath(request.privateRootPath, request.artifactDirRelative), { recursive: true });

console.log(
  `raw open/edit/export private root ok (${copyMode ? 'copy' : 'symlink'}, fixture=${request.fixtureId}, root=${request.privateRootPath})`,
);

async function linkOrCopy(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { force: true });
  if (copyMode) {
    await copyFile(source, target);
    return;
  }

  await symlink(source, target);
  const stat = await lstat(target);
  if (!stat.isSymbolicLink()) fail(`${target}: expected symlink.`);
}

function resolvePrivatePath(root: string, relativePath: string): string {
  if (isAbsolute(relativePath) || relativePath.includes('..')) {
    fail(`${relativePath}: must be private-root relative without traversal.`);
  }
  return resolve(root, relativePath);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function fail(message: string): never {
  console.error(`raw open/edit/export private root failed: ${message}`);
  process.exit(1);
}
