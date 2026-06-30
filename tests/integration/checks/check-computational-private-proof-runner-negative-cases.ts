#!/usr/bin/env bun

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE_ID = 'validation.computational-merge.hdr-bracket-alignment.v1';

await expectRunnerFails({
  args: ['--require-assets'],
  expected: 'RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.',
  label: 'require assets without root',
});

await expectRunnerFails({
  args: ['--require-assets'],
  expected: `${FIXTURE_ID}: --require-assets requires a private run report.`,
  label: 'private step emits no report',
  privateRoot: await mkdtemp(join(tmpdir(), 'rawengine-private-runner-empty-')),
});

await expectRunnerFails({
  args: ['--require-assets'],
  expected: `${FIXTURE_ID}: --require-assets requires a private run report.`,
  label: 'private step emits wrong fixture report',
  privateRoot: await rootWithWrongFixtureReport(),
});

await expectRunnerFails({
  args: ['--require-assets'],
  expected: `${FIXTURE_ID}: runId must match current private proof invocation.`,
  label: 'private step leaves stale report',
  privateRoot: await rootWithStaleFixtureReport(),
});

console.log('computational private proof runner negative cases ok');

async function expectRunnerFails({
  args,
  expected,
  label,
  privateRoot,
}: {
  args: Array<string>;
  expected: string;
  label: string;
  privateRoot?: string;
}): Promise<void> {
  const runnerPath = await writeTempRunnerScript();
  const proc = Bun.spawn(['bun', runnerPath, ...args], {
    env: {
      ...process.env,
      ...(privateRoot === undefined ? {} : { RAWENGINE_PRIVATE_RAW_ROOT: privateRoot }),
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = `${stdout}\n${stderr}`;
  if (exitCode === 0) throw new Error(`${label}: expected runner to fail.`);
  if (!output.includes(expected)) {
    throw new Error(`${label}: expected failure containing "${expected}". Actual output:\n${output.slice(-1200)}`);
  }
}

async function writeTempRunnerScript(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawengine-private-runner-script-'));
  const scriptPath = join(directory, 'runner.ts');
  await writeFile(
    scriptPath,
    `
      import { runComputationalPrivateProof } from '${process.cwd()}/scripts/lib/private-raw/computational-proof-runner.ts';
      await runComputationalPrivateProof({
        featureLabel: 'hdr',
        fixtureId: '${FIXTURE_ID}',
        proofChecks: [],
        privateStep: {
          command: ['bun', '-e', ''],
          label: 'noop private step',
        },
        skipLabel: 'hdr negative proof',
      });
    `,
  );
  return scriptPath;
}

async function rootWithWrongFixtureReport(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rawengine-private-runner-wrong-fixture-'));
  const reportDir = join(root, 'private-artifacts/validation/computational-merge');
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, 'wrong-private-run-report.json'),
    `${JSON.stringify(wrongFixtureCollection(), null, 2)}\n`,
  );
  return root;
}

async function rootWithStaleFixtureReport(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rawengine-private-runner-stale-fixture-'));
  const reportDir = join(root, 'private-artifacts/validation/computational-merge');
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, 'stale-private-run-report.json'),
    `${JSON.stringify(privateReportCollection({ fixtureId: FIXTURE_ID, reportId: 'computational-merge-run.hdr-bracket-alignment.v1', runId: 'stale-run' }), null, 2)}\n`,
  );
  return root;
}

function wrongFixtureCollection() {
  return privateReportCollection({
    fixtureId: 'validation.computational-merge.other-hdr.v1',
    reportId: 'computational-merge-run.other-hdr.v1',
  });
}

function privateReportCollection({
  fixtureId,
  reportId,
  runId,
}: {
  fixtureId: string;
  reportId: string;
  runId?: string;
}) {
  const hash = `sha256:${'0'.repeat(64)}`;
  const asset = (path: string) => ({ hash, path, publicRepoAllowed: false });
  const source = (path: string) => ({ ...asset(path), localRelativePath: path });
  const artifact = (kind: string, path: string) => ({ ...asset(path), kind });
  const metric = (name: string, threshold: number, value: number) => ({
    name,
    passed: true,
    source: 'private_raw_report',
    threshold,
    value,
  });
  const previewExportParity = metric('previewExportMeanAbsDelta', 0.015, 0);

  return {
    $schema: 'https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json',
    issue: 1817,
    reports: [
      {
        acceptanceStatus: 'runtime_apply_capable',
        artifacts: [
          artifact('source_raw_sequence_private', 'private-fixtures/hdr/bracket-alignment-v1'),
          artifact(
            'alignment_report_private',
            'private-artifacts/validation/computational-merge/hdr-bracket-alignment.json',
          ),
          artifact('merge_output_private', 'private-artifacts/validation/computational-merge/hdr-bracket-merge.tiff'),
          artifact(
            'app_server_runtime_report_private',
            'private-artifacts/validation/computational-merge/hdr-bracket-app-server-runtime.json',
          ),
          artifact('preview_after_private', 'private-artifacts/validation/computational-merge/hdr-bracket-preview.png'),
          artifact('export_after_private', 'private-artifacts/validation/computational-merge/hdr-bracket-export.tiff'),
          artifact(
            'quality_report_private',
            'private-artifacts/validation/computational-merge/hdr-bracket-quality.json',
          ),
        ],
        commandIds: { apply: 'command_apply', dryRun: 'command_dry_run' },
        featureFamily: 'hdr_merge',
        fixtureId,
        generatedAt: '2026-06-18T00:00:00.000Z',
        graphRevisionHash: hash,
        implementationIssue: 2062,
        notes: 'wrong fixture negative case',
        previewExportParity,
        qualityMetrics: [
          metric('exposureBracketCoverageEv', 4, 4),
          metric('highlightRecoveryRatio', 1.1, 1.1),
          metric('ghostSuppressionScore', 0.85, 0.85),
          previewExportParity,
        ],
        reportId,
        ...(runId === undefined ? {} : { runId }),
        runtimeResultIds: { apply: 'runtime_apply', dryRun: 'runtime_dry_run' },
        screenshotArtifacts: [
          {
            ...asset('private-artifacts/validation/computational-merge/modal-before.png'),
            label: 'modal_before_apply',
          },
          { ...asset('private-artifacts/validation/computational-merge/modal-after.png'), label: 'modal_after_apply' },
        ],
        sourceHashes: [
          source('private-fixtures/hdr/bracket-alignment-v1/frame-01-under.arw'),
          source('private-fixtures/hdr/bracket-alignment-v1/frame-02-mid.arw'),
          source('private-fixtures/hdr/bracket-alignment-v1/frame-03-over.arw'),
        ],
        uiIssue: 171,
      },
    ],
    schemaVersion: 1,
    snapshotDate: '2026-06-18',
    validationMode: 'public_schema_private_reports',
  };
}
