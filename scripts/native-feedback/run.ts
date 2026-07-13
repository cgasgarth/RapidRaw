#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { acquireResourceLease } from '../lib/ci/resource-coordinator';
import { compareNativeFeedbackReceipts, runNativeFeedbackBenchmark } from './benchmark';
import { captureNativeFeedbackIdentity, computeNativeSourceDigest } from './identity';
import {
  type NativeFeedbackProfile,
  nativeFeedbackProfiles,
  nativeFeedbackReceiptSchema,
  nativeFeedbackSampleSchema,
  resolveNativeFeedbackProfileForPlatform,
} from './model';
import { createNativeCiPartitionPlan } from './planner';
import { writeNativeFeedbackReceipt } from './receipt-io';
import { createCargoNativeFeedbackExecutor } from './runtime';

const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const values = (flag: string): string[] =>
  args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ''] : [])).filter(Boolean);
const profile = (id: string | undefined): NativeFeedbackProfile => {
  const selected = nativeFeedbackProfiles.find((candidate) => candidate.id === id);
  if (selected === undefined) throw new Error(`Unknown native feedback profile: ${id ?? '<missing>'}`);
  return resolveNativeFeedbackProfileForPlatform(selected, process.platform);
};

if (args[0] === 'profiles') {
  for (const candidate of nativeFeedbackProfiles)
    console.log(`${candidate.id}\t${candidate.purpose}\topt=${candidate.optLevel}\tcgu=${candidate.codegenUnits}`);
  process.exit(0);
}

if (args[0] === 'plan') {
  const selectedProfile = profile(value('--profile') ?? 'rapid-dev-fast');
  const identity = await captureNativeFeedbackIdentity();
  const plan = createNativeCiPartitionPlan({
    mode: z.enum(['commit', 'push', 'pr', 'full', 'release']).parse(value('--mode') ?? 'commit'),
    changedPaths: values('--path'),
    profile: selectedProfile,
    identity: {
      cargoLockDigest: identity.cargoLockDigest,
      workspaceManifestDigest: identity.workspaceManifestDigest,
      sourceDigest: await computeNativeSourceDigest(),
      rustc: identity.rustc,
      environment: `${process.platform}-${process.arch}`,
    },
  });
  console.log(JSON.stringify(plan));
  process.exit(0);
}

if (args[0] === 'benchmark-plan') {
  const selectedProfile = profile(value('--profile') ?? 'rapid-dev-fast');
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      profile: selectedProfile,
      protocol: { order: ['clean', 'noop', 'leaf-edit', 'core-edit'], warmupRuns: 1, measuredRuns: 5 },
      requiredMetrics: [
        'wallMs',
        'criticalPathMs',
        'rebuiltCrates',
        'linkMs',
        'peakRssBytes',
        'artifactBytes',
        'timeToTestMs',
      ],
      destructiveActions: [],
    }),
  );
  process.exit(0);
}

if (args[0] === 'benchmark') {
  const inputPath = value('--input');
  const outputPath = value('--output');
  const selectedProfile = profile(value('--profile') ?? 'rapid-dev-fast');
  if (inputPath === undefined || outputPath === undefined)
    throw new Error(
      'Usage: bun native-feedback benchmark --profile <id> --input <samples.json> --output <receipt.json>',
    );
  const samples = z.array(nativeFeedbackSampleSchema).parse(JSON.parse(await readFile(resolve(inputPath), 'utf8')));
  const byIdentity = new Map(samples.map((sample) => [`${sample.scenario}:${sample.iteration}`, sample]));
  const identity = await captureNativeFeedbackIdentity();
  const receipt = await runNativeFeedbackBenchmark({
    profile: selectedProfile,
    executor: {
      async run({ scenario, iteration }) {
        const sample = byIdentity.get(`${scenario}:${iteration}`);
        if (sample === undefined) throw new Error(`Input omitted ${scenario}/${iteration}.`);
        return sample;
      },
    },
    identity,
    warmupRuns: Number(value('--warmups') ?? '1'),
    measuredRuns: Number(value('--runs') ?? '5'),
    startedAt: new Date().toISOString(),
    validationCacheKey: createHash('sha256')
      .update(JSON.stringify({ identity, profile: selectedProfile, samples }))
      .digest('hex'),
    rerunCommand: [
      'bun',
      'native-feedback',
      'benchmark',
      '--profile',
      selectedProfile.id,
      '--input',
      resolve(inputPath),
      '--output',
      resolve(outputPath),
      '--warmups',
      String(value('--warmups') ?? '1'),
      '--runs',
      String(value('--runs') ?? '5'),
    ]
      .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
      .join(' '),
  });
  await writeNativeFeedbackReceipt(outputPath, receipt);
  console.log(`PASS ${receipt.profile.id} samples=${receipt.samples.length} receipt=${resolve(outputPath)}`);
  process.exit(0);
}

if (args[0] === 'measure') {
  const outputPath = value('--output');
  const scope = z.enum(['leaf', 'core']).parse(value('--scope'));
  const selectedProfile = profile(value('--profile') ?? 'rapid-dev-fast');
  if (outputPath === undefined)
    throw new Error('Usage: bun native-feedback measure --scope <leaf|core> --profile <id> --output <receipt.json>');
  const targetDir = resolve(
    value('--target-dir') ?? `private-artifacts/native-feedback/target-${scope}-${selectedProfile.id}`,
  );
  let workspaceRoot = resolve(value('--source-dir') ?? `${targetDir}-source`);
  const warmupRuns = Number(value('--warmups') ?? '1');
  const measuredRuns = Number(value('--runs') ?? '3');
  const config =
    scope === 'leaf'
      ? {
          cargoArguments: ['test', '-p', 'rapidraw-types', '--no-run'],
          leafPath: 'src-tauri/crates/rapidraw-types/src/lib.rs',
          corePath: 'src-tauri/Cargo.toml',
        }
      : {
          cargoArguments: [
            'test',
            '--lib',
            '--no-run',
            '--no-default-features',
            '--features',
            'required-ci,tauri-test',
          ],
          focusedCargoArguments:
            selectedProfile.id === 'dev-baseline' ? undefined : ['test', '-p', 'rapidraw-types', '--no-run'],
          cleanPreparationCargoArguments:
            selectedProfile.id === 'dev-baseline' ? undefined : ['test', '-p', 'rapidraw-types', '--no-run'],
          leafPath: 'src-tauri/crates/rapidraw-types/src/lib.rs',
          corePath: 'src-tauri/src/lib.rs',
        };
  const identity = await captureNativeFeedbackIdentity();
  const rerunCommand = [
    'bun',
    'native-feedback',
    'measure',
    '--scope',
    scope,
    '--profile',
    selectedProfile.id,
    '--output',
    resolve(outputPath),
    '--target-dir',
    targetDir,
    '--warmups',
    String(warmupRuns),
    '--runs',
    String(measuredRuns),
  ]
    .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
    .join(' ');
  const lease = await acquireResourceLease({ label: `native-feedback-${scope}`, resource: 'native-heavy' });
  let runtime: Awaited<ReturnType<typeof createCargoNativeFeedbackExecutor>> | undefined;
  let complete = false;
  const cancellation = new AbortController();
  const cancel = () => {
    runtime?.restoreSync();
    runtime?.invalidateSync();
    cancellation.abort(new Error('Native feedback measurement interrupted.'));
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    await rm(workspaceRoot, { force: true, recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    workspaceRoot = await realpath(workspaceRoot);
    const copy = Bun.spawnSync(
      [
        '/usr/bin/rsync',
        '-a',
        '--delete',
        '--exclude',
        '.git',
        '--exclude',
        'node_modules',
        '--exclude',
        'src-tauri/target',
        '--exclude',
        'private-artifacts',
        `${resolve('.')}/`,
        `${workspaceRoot}/`,
      ],
      { stderr: 'pipe', stdout: 'pipe' },
    );
    if (copy.exitCode !== 0) throw new Error(`Native feedback source isolation failed: ${copy.stderr}`);
    runtime = await createCargoNativeFeedbackExecutor({
      workspaceRoot,
      targetDir,
      signal: cancellation.signal,
      ...config,
    });
    const receipt = await runNativeFeedbackBenchmark({
      profile: selectedProfile,
      executor: runtime.executor,
      identity,
      warmupRuns,
      measuredRuns,
      startedAt: new Date().toISOString(),
      validationCacheKey: createHash('sha256')
        .update(JSON.stringify({ identity, profile: selectedProfile, scope, config }))
        .digest('hex'),
      rerunCommand,
    });
    await writeNativeFeedbackReceipt(outputPath, receipt);
    complete = true;
    console.log(
      `PASS ${receipt.profile.id} scope=${scope} samples=${receipt.samples.length} receipt=${resolve(outputPath)}`,
    );
  } finally {
    await runtime?.restore();
    if (!complete) await runtime?.invalidate();
    await rm(workspaceRoot, { force: true, recursive: true });
    await lease.release();
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
  process.exit(0);
}

if (args[0] === 'compare') {
  const baselinePath = args[1];
  const candidatePath = args[2];
  if (baselinePath === undefined || candidatePath === undefined)
    throw new Error('Usage: bun native-feedback compare <baseline.json> <candidate.json>');
  const [baseline, candidate] = await Promise.all(
    [baselinePath, candidatePath].map(async (path) =>
      nativeFeedbackReceiptSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8'))),
    ),
  );
  const comparison = compareNativeFeedbackReceipts(baseline, candidate);
  console.log(JSON.stringify(comparison));
  process.exit(comparison.status === 'regression' ? 1 : comparison.majorCommonFeedbackReduction ? 0 : 2);
}

throw new Error('Usage: bun native-feedback <profiles|plan|benchmark-plan|benchmark|measure|compare>');
