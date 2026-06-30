import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { z } from 'zod';

import { parseComputationalMergePrivateRunReportCollection } from '../../../src/schemas/computational-merge/computationalMergePrivateRunReportSchemas.ts';
import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../ci/compact-output.ts';

const argsSchema = z
  .object({
    outputPath: z.string().trim().min(1).optional(),
    privateRoot: z.string().trim().min(1).optional(),
    requireAssets: z.boolean(),
  })
  .strict();

export interface ComputationalPrivateProofRunnerConfig {
  featureLabel: string;
  fixtureId: string;
  postPrivateChecks?: Array<Array<string>>;
  proofChecks: Array<Array<string>>;
  privateStep: {
    command: Array<string>;
    cwd?: string;
    env?: Record<string, string>;
    label: string;
  };
  skipLabel: string;
}

interface RunOptions {
  command: Array<string>;
  cwd?: string;
  env?: Record<string, string>;
}

export async function runComputationalPrivateProof(config: ComputationalPrivateProofRunnerConfig): Promise<void> {
  const args = argsSchema.parse({
    outputPath: valueAfter('--output'),
    privateRoot: valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT,
    requireAssets: process.argv.includes('--require-assets'),
  });

  for (const check of config.proofChecks) {
    await runCompact(check.join(' '), { command: check });
  }

  if (args.privateRoot === undefined) {
    if (args.requireAssets) {
      console.error('RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.');
      process.exit(1);
    }
    console.log(`${config.skipLabel} skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)`);
    return;
  }

  const privateRoot = resolve(args.privateRoot);
  const runId = `private-run-${Date.now()}-${randomUUID()}`;
  let tempOutputDir: string | undefined;
  const reportOutputPath =
    args.outputPath ??
    join(
      (tempOutputDir = await mkdtemp(join(tmpdir(), 'rawengine-computational-private-report-'))),
      'computational-merge-private-run-reports.json',
    );

  if (args.outputPath !== undefined) {
    await mkdir(dirname(reportOutputPath), { recursive: true });
  }

  try {
    await runCompact(config.privateStep.label, {
      command: config.privateStep.command,
      cwd: config.privateStep.cwd,
      env: {
        RAWENGINE_COMPUTATIONAL_PRIVATE_RUN_ID: runId,
        RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
        ...config.privateStep.env,
      },
    });

    for (const check of config.postPrivateChecks ?? []) {
      await runCompact(check.join(' '), {
        command: check,
        env: { RAWENGINE_COMPUTATIONAL_PRIVATE_RUN_ID: runId, RAWENGINE_PRIVATE_RAW_ROOT: privateRoot },
      });
    }

    await runCompact('computational merge private report collection', {
      command: [
        'bun',
        'scripts/private-raw/proofs/computational/collect-computational-merge-private-run-reports.ts',
        '--root',
        privateRoot,
        '--output',
        reportOutputPath,
      ],
    });

    const collectedReports = parseComputationalMergePrivateRunReportCollection(
      JSON.parse(await readFile(reportOutputPath, 'utf8')),
    );
    const reportPresent = collectedReports.reports.some((report) => report.fixtureId === config.fixtureId);
    if (!reportPresent && !args.requireAssets) {
      console.log(`${config.skipLabel} skipped (no private run report for ${config.fixtureId})`);
      return;
    }

    await runCompact('computational merge private report validation', {
      command: [
        'bun',
        'tests/integration/checks/check-computational-merge-private-run-reports.ts',
        '--fixture-id',
        config.fixtureId,
        '--input',
        reportOutputPath,
        ...(args.requireAssets ? ['--require-run-id', runId] : []),
        ...(args.requireAssets ? ['--require-assets'] : []),
      ],
      env: {
        RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
      },
    });
  } finally {
    if (tempOutputDir !== undefined) await rm(tempOutputDir, { force: true, recursive: true });
  }

  console.log(`${config.featureLabel} real RAW private proof ok`);
}

async function runCompact(label: string, options: RunOptions): Promise<void> {
  const proc = Bun.spawn(options.command, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  if (exitCode === 0) return;

  console.error(`${label} failed`);
  console.error(`$ ${formatCommandForLog(options.command[0] ?? '', options.command.slice(1))}`);
  writeBoundedOutput('stdout', await stdout);
  writeBoundedOutput('stderr', await stderr);
  process.exit(exitCode);
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
