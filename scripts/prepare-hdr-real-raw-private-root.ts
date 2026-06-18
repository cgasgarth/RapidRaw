#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { z } from 'zod';

import { parseComputationalMergeE2eProofManifest } from '../src/schemas/computationalMergeE2eProofSchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../src/schemas/privateRawEvidenceSchemas.ts';

const argvSchema = z
  .object({
    requireAssets: z.boolean(),
    root: z.string().trim().min(1),
    selfTest: z.boolean(),
  })
  .strict();

const expectedFixtureId = 'validation.computational-merge.hdr-bracket-alignment.v1';
const defaultPrivateRoot = '/tmp/rawengine-private-root';

const args = argvSchema.parse({
  requireAssets: process.argv.includes('--require-assets'),
  root: process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? defaultPrivateRoot,
  selfTest: process.argv.includes('--self-test'),
});

if (args.selfTest) {
  await runSelfTest();
  console.log('hdr real RAW private root prep self-test ok');
  process.exit(0);
}

const manifest = parseComputationalMergeE2eProofManifest(
  JSON.parse(await readFile('fixtures/validation/computational-merge-e2e-proof.json', 'utf8')),
);
const ledger = parsePrivateRawEvidenceLedger(
  JSON.parse(await readFile('fixtures/detail/private-raw-evidence-ledger.json', 'utf8')),
);

const result = await prepareHdrPrivateRoot({
  manifest,
  privateRoot: args.root,
  requireAssets: args.requireAssets,
  ledger,
});

if (!result.ok) {
  console.error('hdr real RAW private root prep failed');
  console.error(result.failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log(result.message);

interface PrepareResult {
  failures: Array<string>;
  message: string;
  ok: boolean;
}

type ComputationalMergeE2eProofManifest = ReturnType<typeof parseComputationalMergeE2eProofManifest>;
type PrivateRawEvidenceLedger = ReturnType<typeof parsePrivateRawEvidenceLedger>;

async function prepareHdrPrivateRoot(input: {
  ledger: PrivateRawEvidenceLedger;
  manifest: ComputationalMergeE2eProofManifest;
  privateRoot: string;
  requireAssets: boolean;
}): Promise<PrepareResult> {
  const failures: Array<string> = [];
  const privateRoot = resolve(input.privateRoot);

  if (!isAbsolute(input.privateRoot)) {
    failures.push('RAWENGINE_PRIVATE_RAW_ROOT must be absolute.');
  }

  const proofCase = input.manifest.proofCases.find((candidate) => candidate.fixtureId === expectedFixtureId);
  if (proofCase === undefined) {
    failures.push(`${expectedFixtureId}: missing HDR proof case.`);
    return failure(failures);
  }
  if (proofCase.featureFamily !== 'hdr_merge')
    failures.push(`${proofCase.fixtureId}: featureFamily must be hdr_merge.`);
  if (proofCase.localSourceRelativePaths.length !== 3) {
    failures.push(`${proofCase.fixtureId}: expected exactly 3 bracket source paths.`);
  }

  const ledgerEntry = input.ledger.entries.find((entry) => entry.evidenceId === proofCase.evidenceId);
  if (ledgerEntry === undefined) {
    failures.push(`${proofCase.evidenceId}: missing private RAW evidence ledger entry.`);
  } else {
    if (ledgerEntry.featureFamily !== 'hdr_merge') {
      failures.push(`${ledgerEntry.evidenceId}: ledger featureFamily must be hdr_merge.`);
    }
    if (ledgerEntry.trackingIssue !== 1509) {
      failures.push(`${ledgerEntry.evidenceId}: ledger trackingIssue must be #1509.`);
    }
  }

  for (const sourcePath of proofCase.localSourceRelativePaths) {
    if (extname(sourcePath).toLowerCase() !== '.arw') {
      failures.push(`${sourcePath}: HDR private proof source must be ARW.`);
    }
    resolvePrivatePath(privateRoot, sourcePath, failures);
  }
  for (const artifact of proofCase.artifacts) {
    resolvePrivatePath(privateRoot, artifact.path, failures);
  }
  if (failures.length > 0) return failure(failures);

  const sourcePaths = proofCase.localSourceRelativePaths.map((sourcePath) =>
    resolvePrivatePath(privateRoot, sourcePath, failures),
  );
  await mkdir(dirname(sourcePaths[0] ?? resolve(privateRoot, 'private-fixtures/hdr/.keep')), { recursive: true });
  for (const artifact of proofCase.artifacts) {
    const artifactPath = resolvePrivatePath(privateRoot, artifact.path, failures);
    await mkdir(artifact.kind === 'source_raw_sequence_private' ? artifactPath : dirname(artifactPath), {
      recursive: true,
    });
  }

  const presentSources: Array<{ hash: string; path: string }> = [];
  const missingSources: Array<string> = [];
  for (const sourcePath of sourcePaths) {
    if (await pathExists(sourcePath)) {
      presentSources.push({
        hash: await sha256(sourcePath),
        path: relative(privateRoot, sourcePath),
      });
    } else {
      missingSources.push(relative(privateRoot, sourcePath));
    }
  }

  if (missingSources.length === sourcePaths.length && !input.requireAssets) {
    return {
      failures: [],
      message: `hdr real RAW private root prep skipped (add 3 ARW bracket files under ${privateRoot})`,
      ok: true,
    };
  }
  if (missingSources.length > 0) {
    return failure(missingSources.map((sourcePath) => `missing private RAW source ${sourcePath}`));
  }

  const hashSummary = presentSources.map((source) => `${source.path}=${source.hash.slice(0, 19)}...`).join(', ');
  return {
    failures: [],
    message: `hdr real RAW private root prep ok (${presentSources.length} sources, ${hashSummary})`,
    ok: true,
  };
}

async function runSelfTest(): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'rawengine-hdr-private-root-'));
  try {
    const fixturePath = 'private-fixtures/hdr/bracket-alignment-v1';
    const sourceNames = ['frame-01-under.arw', 'frame-02-mid.arw', 'frame-03-over.arw'];
    for (const [index, sourceName] of sourceNames.entries()) {
      const sourcePath = resolve(root, fixturePath, sourceName);
      await mkdir(dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, `fake-private-raw-${index}`);
    }

    const manifest = parseComputationalMergeE2eProofManifest(
      JSON.parse(await readFile('fixtures/validation/computational-merge-e2e-proof.json', 'utf8')),
    );
    const ledger = parsePrivateRawEvidenceLedger(
      JSON.parse(await readFile('fixtures/detail/private-raw-evidence-ledger.json', 'utf8')),
    );
    const result = await prepareHdrPrivateRoot({
      ledger,
      manifest,
      privateRoot: root,
      requireAssets: true,
    });
    if (!result.ok || !result.message.includes('3 sources')) {
      throw new Error(result.failures.join('; ') || 'expected prepared HDR root with 3 sources');
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function resolvePrivatePath(root: string, candidate: string, failures: Array<string>): string {
  if (isAbsolute(candidate) || candidate.includes('..')) {
    failures.push(`${candidate}: must be private-root relative without traversal.`);
    return root;
  }
  const resolvedPath = resolve(root, candidate);
  const relativePath = relative(root, resolvedPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    failures.push(`${candidate}: resolves outside private root.`);
  }
  return resolvedPath;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path: string): Promise<string> {
  return `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
}

function failure(failures: Array<string>): PrepareResult {
  return {
    failures,
    message: '',
    ok: false,
  };
}
