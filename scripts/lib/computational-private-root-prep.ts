import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';

import { z } from 'zod';

import { parseComputationalMergeE2eProofManifest } from '../../src/schemas/computationalMergeE2eProofSchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../../src/schemas/privateRawEvidenceSchemas.ts';

const argsSchema = z
  .object({
    privateRoot: z.string().trim().min(1),
    requireAssets: z.boolean(),
    selfTest: z.boolean(),
  })
  .strict();

const DEFAULT_PRIVATE_ROOT = '/tmp/rawengine-private-root';

export interface ComputationalPrivateRootPrepConfig {
  expectedExtension: string;
  featureFamily: 'focus_stack' | 'hdr_merge' | 'panorama_stitch' | 'super_resolution';
  featureLabel: string;
  fixtureId: string;
  issue: number;
  minSources: number;
  sourceLabel: string;
  tempPrefix: string;
}

interface PrepareResult {
  failures: Array<string>;
  message: string;
  ok: boolean;
}

type Manifest = ReturnType<typeof parseComputationalMergeE2eProofManifest>;
type Ledger = ReturnType<typeof parsePrivateRawEvidenceLedger>;

export async function runComputationalPrivateRootPrep(config: ComputationalPrivateRootPrepConfig): Promise<void> {
  const args = argsSchema.parse({
    privateRoot: process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? DEFAULT_PRIVATE_ROOT,
    requireAssets: process.argv.includes('--require-assets'),
    selfTest: process.argv.includes('--self-test'),
  });

  if (args.selfTest) {
    await runSelfTest(config);
    console.log(`${config.featureLabel} real RAW private root prep self-test ok`);
    return;
  }

  const manifest = await readManifest();
  const ledger = await readLedger();
  const result = await preparePrivateRoot(config, manifest, ledger, args.privateRoot, args.requireAssets);
  if (!result.ok) {
    console.error(`${config.featureLabel} real RAW private root prep failed`);
    console.error(result.failures.slice(0, 12).join('\n'));
    process.exit(1);
  }
  console.log(result.message);
}

async function preparePrivateRoot(
  config: ComputationalPrivateRootPrepConfig,
  manifest: Manifest,
  ledger: Ledger,
  privateRootInput: string,
  requireAssets: boolean,
): Promise<PrepareResult> {
  const failures: Array<string> = [];
  const privateRoot = resolve(privateRootInput);
  if (!isAbsolute(privateRootInput)) failures.push('RAWENGINE_PRIVATE_RAW_ROOT must be absolute.');

  const proofCase = manifest.proofCases.find((candidate) => candidate.fixtureId === config.fixtureId);
  if (proofCase === undefined) return failure([`${config.fixtureId}: missing proof case.`]);
  if (proofCase.featureFamily !== config.featureFamily) {
    failures.push(`${proofCase.fixtureId}: featureFamily must be ${config.featureFamily}.`);
  }
  if (proofCase.implementationIssue !== config.issue) {
    failures.push(`${proofCase.fixtureId}: implementationIssue must be #${config.issue}.`);
  }
  if (proofCase.localSourceRelativePaths.length < config.minSources) {
    failures.push(`${proofCase.fixtureId}: expected at least ${config.minSources} source paths.`);
  }

  const ledgerEntry = ledger.entries.find((entry) => entry.evidenceId === proofCase.evidenceId);
  if (ledgerEntry === undefined) {
    failures.push(`${proofCase.evidenceId}: missing private RAW evidence ledger entry.`);
  } else {
    if (ledgerEntry.featureFamily !== config.featureFamily) {
      failures.push(`${ledgerEntry.evidenceId}: ledger featureFamily must be ${config.featureFamily}.`);
    }
    if (ledgerEntry.trackingIssue !== config.issue) {
      failures.push(`${ledgerEntry.evidenceId}: ledger trackingIssue must be #${config.issue}.`);
    }
  }

  const sourcePaths = proofCase.localSourceRelativePaths.map((sourcePath) => {
    if (extname(sourcePath).toLowerCase() !== config.expectedExtension) {
      failures.push(`${sourcePath}: expected ${config.expectedExtension.slice(1).toUpperCase()} source.`);
    }
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
      message: `${config.featureLabel} real RAW private root prep skipped (add ${sourcePaths.length} ${config.sourceLabel} under ${privateRoot})`,
      ok: true,
    };
  }
  if (missingSources.length > 0) {
    return failure(missingSources.map((sourcePath) => `missing private RAW source ${sourcePath}`));
  }

  return {
    failures: [],
    message: `${config.featureLabel} real RAW private root prep ok (${sourcePaths.length} sources)`,
    ok: true,
  };
}

async function runSelfTest(config: ComputationalPrivateRootPrepConfig): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), config.tempPrefix));
  try {
    const manifest = await readManifest();
    const ledger = await readLedger();
    const proofCase = manifest.proofCases.find((candidate) => candidate.fixtureId === config.fixtureId);
    if (proofCase === undefined) throw new Error(`${config.fixtureId}: missing proof case.`);

    for (const sourcePath of proofCase.localSourceRelativePaths) {
      const absolutePath = resolve(root, sourcePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, `fake-private-${config.featureLabel}-raw-${basename(sourcePath)}`);
    }

    const result = await preparePrivateRoot(config, manifest, ledger, root, true);
    if (!result.ok || !result.message.includes(`${proofCase.localSourceRelativePaths.length} sources`)) {
      throw new Error(result.failures.join('; ') || `expected ${proofCase.localSourceRelativePaths.length} sources`);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function readManifest(): Promise<Manifest> {
  return parseComputationalMergeE2eProofManifest(
    JSON.parse(await readFile('fixtures/validation/computational-merge-e2e-proof.json', 'utf8')),
  );
}

async function readLedger(): Promise<Ledger> {
  return parsePrivateRawEvidenceLedger(
    JSON.parse(await readFile('fixtures/detail/private-raw-evidence-ledger.json', 'utf8')),
  );
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
