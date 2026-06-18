#!/usr/bin/env bun

import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';

import { z } from 'zod';

import { parseComputationalMergeE2eProofManifest } from '../src/schemas/computationalMergeE2eProofSchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../src/schemas/privateRawEvidenceSchemas.ts';

const argsSchema = z
  .object({
    privateRoot: z.string().trim().min(1),
    requireAssets: z.boolean(),
    selfTest: z.boolean(),
  })
  .strict();

const EXPECTED_FIXTURE_ID = 'validation.computational-merge.focus-plane-transition.v1';
const EXPECTED_FEATURE_FAMILY = 'focus_stack';
const EXPECTED_ISSUE = 1507;
const DEFAULT_PRIVATE_ROOT = '/tmp/rawengine-private-root';

const args = argsSchema.parse({
  privateRoot: process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? DEFAULT_PRIVATE_ROOT,
  requireAssets: process.argv.includes('--require-assets'),
  selfTest: process.argv.includes('--self-test'),
});

if (args.selfTest) {
  await runSelfTest();
  console.log('focus real RAW private root prep self-test ok');
  process.exit(0);
}

const manifest = parseComputationalMergeE2eProofManifest(
  JSON.parse(await readFile('fixtures/validation/computational-merge-e2e-proof.json', 'utf8')),
);
const ledger = parsePrivateRawEvidenceLedger(
  JSON.parse(await readFile('fixtures/detail/private-raw-evidence-ledger.json', 'utf8')),
);
const result = await preparePrivateRoot(manifest, ledger, args.privateRoot, args.requireAssets);
if (!result.ok) {
  console.error('focus real RAW private root prep failed');
  console.error(result.failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log(result.message);

type Manifest = ReturnType<typeof parseComputationalMergeE2eProofManifest>;
type Ledger = ReturnType<typeof parsePrivateRawEvidenceLedger>;

interface PrepareResult {
  failures: Array<string>;
  message: string;
  ok: boolean;
}

async function preparePrivateRoot(
  manifest: Manifest,
  ledger: Ledger,
  privateRootInput: string,
  requireAssets: boolean,
): Promise<PrepareResult> {
  const failures: Array<string> = [];
  const privateRoot = resolve(privateRootInput);
  if (!isAbsolute(privateRootInput)) failures.push('RAWENGINE_PRIVATE_RAW_ROOT must be absolute.');

  const proofCase = manifest.proofCases.find((candidate) => candidate.fixtureId === EXPECTED_FIXTURE_ID);
  if (proofCase === undefined) return failure([`${EXPECTED_FIXTURE_ID}: missing focus proof case.`]);
  if (proofCase.featureFamily !== EXPECTED_FEATURE_FAMILY) {
    failures.push(`${proofCase.fixtureId}: featureFamily must be ${EXPECTED_FEATURE_FAMILY}.`);
  }
  if (proofCase.implementationIssue !== EXPECTED_ISSUE) {
    failures.push(`${proofCase.fixtureId}: implementationIssue must be #${EXPECTED_ISSUE}.`);
  }
  if (proofCase.localSourceRelativePaths.length < 3) {
    failures.push(`${proofCase.fixtureId}: expected at least 3 focus plane source paths.`);
  }

  const ledgerEntry = ledger.entries.find((entry) => entry.evidenceId === proofCase.evidenceId);
  if (ledgerEntry === undefined) {
    failures.push(`${proofCase.evidenceId}: missing private RAW evidence ledger entry.`);
  } else {
    if (ledgerEntry.featureFamily !== EXPECTED_FEATURE_FAMILY) {
      failures.push(`${ledgerEntry.evidenceId}: ledger featureFamily must be ${EXPECTED_FEATURE_FAMILY}.`);
    }
    if (ledgerEntry.trackingIssue !== EXPECTED_ISSUE) {
      failures.push(`${ledgerEntry.evidenceId}: ledger trackingIssue must be #${EXPECTED_ISSUE}.`);
    }
  }

  const sourcePaths = proofCase.localSourceRelativePaths.map((sourcePath) => {
    if (extname(sourcePath).toLowerCase() !== '.cr3') failures.push(`${sourcePath}: expected CR3 source.`);
    return resolvePrivatePath(privateRoot, sourcePath, failures);
  });
  for (const artifact of proofCase.artifacts) {
    const artifactPath = resolvePrivatePath(privateRoot, artifact.path, failures);
    await mkdir(artifact.kind === 'source_raw_sequence_private' ? artifactPath : dirname(artifactPath), {
      recursive: true,
    });
  }
  if (sourcePaths[0] !== undefined) await mkdir(dirname(sourcePaths[0]), { recursive: true });
  if (failures.length > 0) return failure(failures);

  const missingSources = [];
  for (const sourcePath of sourcePaths) {
    if (!(await pathExists(sourcePath))) missingSources.push(relative(privateRoot, sourcePath));
  }

  if (missingSources.length === sourcePaths.length && !requireAssets) {
    return {
      failures: [],
      message: `focus real RAW private root prep skipped (add ${sourcePaths.length} CR3 focus frames under ${privateRoot})`,
      ok: true,
    };
  }
  if (missingSources.length > 0) {
    return failure(missingSources.map((sourcePath) => `missing private RAW source ${sourcePath}`));
  }

  return {
    failures: [],
    message: `focus real RAW private root prep ok (${sourcePaths.length} sources)`,
    ok: true,
  };
}

async function runSelfTest(): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'rawengine-focus-private-root-'));
  try {
    for (const sourceName of ['frame-01.cr3', 'frame-02.cr3', 'frame-03.cr3']) {
      const sourcePath = resolve(root, 'private-fixtures/focus-stack/plane-transition-v1', sourceName);
      await mkdir(dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, `fake-private-focus-raw-${sourceName}`);
    }
    const manifest = parseComputationalMergeE2eProofManifest(
      JSON.parse(await readFile('fixtures/validation/computational-merge-e2e-proof.json', 'utf8')),
    );
    const ledger = parsePrivateRawEvidenceLedger(
      JSON.parse(await readFile('fixtures/detail/private-raw-evidence-ledger.json', 'utf8')),
    );
    const result = await preparePrivateRoot(manifest, ledger, root, true);
    if (!result.ok || !result.message.includes('3 sources')) {
      throw new Error(result.failures.join('; ') || 'expected 3 focus sources');
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

function failure(failures: Array<string>): PrepareResult {
  return { failures, message: '', ok: false };
}
