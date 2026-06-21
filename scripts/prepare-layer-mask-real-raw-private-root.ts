#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, copyFile, lstat, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { parsePrivateRawEvidenceLedger } from '../src/schemas/privateRawEvidenceSchemas.ts';

const EVIDENCE_ID = 'raw-evidence.layers.alaska-local-adjustment.v1';
const ARTIFACT_DIR = 'private-artifacts/validation/layer-mask-real-raw';
const args = new Set(process.argv.slice(2));
const copyMode = args.has('--copy');
const requireAssets = args.has('--require-assets');
const privateRootPath = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '/tmp/rawengine-private-root';
const sourceOverridePath = valueAfter('--source') ?? process.env.RAWENGINE_PRIVATE_RAW_SOURCE;

if (!isAbsolute(privateRootPath)) fail('private root must be absolute.');

const ledger = parsePrivateRawEvidenceLedger(
  JSON.parse(await readFile('fixtures/detail/private-raw-evidence-ledger.json', 'utf8')),
);
const entry = ledger.entries.find((candidate) => candidate.evidenceId === EVIDENCE_ID);
if (entry === undefined) fail(`${EVIDENCE_ID}: missing private RAW evidence ledger entry.`);
if (entry.localRelativePath === undefined || entry.fileSha256 === undefined) {
  fail(`${EVIDENCE_ID}: available source path and hash are required.`);
}

if (sourceOverridePath !== undefined) {
  const sourcePath = await resolveSourceOverridePath(resolve(sourceOverridePath), entry.fileSha256);
  await linkOrCopy(sourcePath, resolvePrivatePath(privateRootPath, entry.localRelativePath));
}

const sourcePath = resolvePrivatePath(privateRootPath, entry.localRelativePath);
if (!(await pathExists(sourcePath))) {
  const message = `${EVIDENCE_ID}: missing local source ${entry.localRelativePath}`;
  if (requireAssets) fail(message);
  console.log(`layer/mask private root skipped (${message})`);
  process.exit(0);
}

const sourceHash = hashBuffer(await readFile(sourcePath));
if (sourceHash !== entry.fileSha256) {
  fail(`${EVIDENCE_ID}: expected ${entry.fileSha256}, got ${sourceHash}.`);
}

await mkdir(resolvePrivatePath(privateRootPath, ARTIFACT_DIR), { recursive: true });
console.log(`layer/mask private root ok (${copyMode ? 'copy' : 'symlink'}, root=${privateRootPath})`);

async function resolveSourceOverridePath(path: string, expectedHash: string): Promise<string> {
  if (!(await pathExists(path))) fail(`${path}: source override does not exist.`);
  const sourceStat = await lstat(path);
  if (!sourceStat.isDirectory()) return path;

  const rawCandidates = (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(arw|cr2|cr3|dng|nef|orf|raf|rw2)$/iu.test(entry.name))
    .map((entry) => resolve(path, entry.name));
  const matches: string[] = [];

  for (const candidate of rawCandidates) {
    if (hashBuffer(await readFile(candidate)) === expectedHash) matches.push(candidate);
  }

  if (matches.length === 0) fail(`${path}: source override directory does not contain RAW ${expectedHash}.`);
  if (matches.length > 1) fail(`${path}: source override directory has multiple RAW files with ${expectedHash}.`);
  return matches[0] ?? fail(`${path}: failed to resolve source override.`);
}

async function linkOrCopy(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { force: true });
  if (copyMode) {
    await copyFile(source, target);
    return;
  }
  await symlink(source, target);
}

function resolvePrivatePath(root: string, relativePath: string): string {
  if (isAbsolute(relativePath) || relativePath.includes('..')) fail(`${relativePath}: invalid private path.`);
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

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function fail(message: string): never {
  console.error(`layer/mask private root failed: ${message}`);
  process.exit(1);
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
