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
const manifestPath = valueAfter('--manifest') ?? 'fixtures/validation/raw-open-edit-export-proof.json';
const requestPath = valueAfter('--request') ?? 'fixtures/validation/raw-open-edit-export-proof-request.json';
const sourceOverridePath = valueAfter('--source') ?? process.env.RAWENGINE_PRIVATE_RAW_SOURCE;

const requestJson: unknown = JSON.parse(await readFile(requestPath, 'utf8'));
const proofJson: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
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
const privateRootPath = valueAfter('--root') ?? request.privateRootPath;
if (!isAbsolute(privateRootPath)) {
  fail('privateRootPath must be absolute.');
}

if (sourceOverridePath !== undefined) {
  const overridePath = resolve(sourceOverridePath);
  if (!(await pathExists(overridePath))) fail(`${overridePath}: source override does not exist.`);
  const overrideHash = `sha256:${createHash('sha256')
    .update(await readFile(overridePath))
    .digest('hex')}`;
  if (overrideHash !== ledgerEntry.fileSha256) {
    fail(`${ledgerEntry.evidenceId}: source override expected ${ledgerEntry.fileSha256}, got ${overrideHash}.`);
  }
  await linkOrCopy(overridePath, resolvePrivatePath(privateRootPath, ledgerEntry.localRelativePath));
}

const sourcePath = await resolveSourcePath(privateRootPath, ledgerEntry.localRelativePath);
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
  const targetPath = resolvePrivatePath(privateRootPath, relativePath);
  await linkOrCopy(sourcePath, targetPath);
}
await mkdir(resolvePrivatePath(privateRootPath, request.artifactDirRelative), { recursive: true });

console.log(
  `raw open/edit/export private root ok (${copyMode ? 'copy' : 'symlink'}, fixture=${request.fixtureId}, root=${privateRootPath})`,
);

async function linkOrCopy(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  if (source === target) return;
  await rm(target, { force: true });
  if (copyMode) {
    await copyFile(source, target);
    return;
  }

  await symlink(source, target);
  const stat = await lstat(target);
  if (!stat.isSymbolicLink()) fail(`${target}: expected symlink.`);
}

async function resolveSourcePath(privateRoot: string, localRelativePath: string): Promise<string> {
  const repoLocalSourcePath = resolve(localRelativePath);
  if (await pathExists(repoLocalSourcePath)) return repoLocalSourcePath;

  return resolvePrivatePath(privateRoot, localRelativePath);
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

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
