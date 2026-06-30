#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { parseComputationalMergeE2eProofManifest } from '../../../src/schemas/computationalMergeE2eProofSchemas.ts';
import {
  type ComputationalMergePrivateRunReportCollection,
  parseComputationalMergePrivateRunReportCollection,
} from '../../../src/schemas/computationalMergePrivateRunReportSchemas.ts';

const manifest = parseComputationalMergeE2eProofManifest(
  await Bun.file('fixtures/validation/app-server/computational-merge-e2e-proof.json').json(),
);
const proofCase = manifest.proofCases[0];
if (proofCase === undefined) throw new Error('Missing computational merge proof case fixture.');

const negativeCases = [
  {
    label: 'metric below threshold',
    mutate: (collection: ComputationalMergePrivateRunReportCollection) => {
      collection.reports[0].qualityMetrics[0].value = 0;
      return collection;
    },
    expected: 'value must satisfy threshold',
  },
  {
    label: 'preview export over threshold',
    mutate: (collection: ComputationalMergePrivateRunReportCollection) => {
      const metric = collection.reports[0].qualityMetrics.find(
        (candidate) => candidate.name === 'previewExportMeanAbsDelta',
      );
      if (metric === undefined) throw new Error('Missing previewExportMeanAbsDelta metric.');
      metric.value = metric.threshold + 1;
      collection.reports[0].previewExportParity = metric;
      return collection;
    },
    expected: 'previewExportMeanAbsDelta value must satisfy threshold',
  },
  {
    label: 'duplicate source bytes',
    mutate: (collection: ComputationalMergePrivateRunReportCollection) => {
      collection.reports[0].sourceHashes[1].hash = collection.reports[0].sourceHashes[0].hash;
      return collection;
    },
    expected: 'source hashes must be unique',
  },
  {
    label: 'unknown fixture',
    mutate: (collection: ComputationalMergePrivateRunReportCollection) => {
      collection.reports[0].fixtureId = 'validation.computational-merge.unknown.v1';
      return collection;
    },
    expected: 'has no manifest proof case',
  },
];

for (const testCase of negativeCases) {
  const collection = testCase.mutate(sampleCollection());
  const inputPath = await writeTempCollection(collection);
  await expectCheckerFails(testCase.label, ['--input', inputPath], testCase.expected);
}

await runSymlinkEscapeCase();

console.log('computational private report checker negative cases ok');

async function runSymlinkEscapeCase(): Promise<void> {
  const privateRoot = await mkdtemp(join(tmpdir(), 'rawengine-private-negative-root-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'rawengine-private-negative-outside-'));
  const outsideFile = join(outsideRoot, 'escaped.bin');
  await writeFile(outsideFile, 'escaped');

  const collection = sampleCollection();
  const report = collection.reports[0];
  const escapedPath = 'private-artifacts/validation/computational-merge/escaped.bin';
  report.artifacts[0].path = escapedPath;
  report.artifacts[0].hash = sha256('escaped');

  const linkPath = join(privateRoot, escapedPath);
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(outsideFile, linkPath);
  const inputPath = await writeTempCollection(collection);
  await expectCheckerFails(
    'symlink escape',
    ['--require-assets', '--input', inputPath],
    'escapes private root',
    privateRoot,
  );
}

async function expectCheckerFails(
  label: string,
  args: Array<string>,
  expected: string,
  privateRoot?: string,
): Promise<void> {
  const proc = Bun.spawn(
    ['bun', 'tests/integration/checks/check-computational-merge-private-run-reports.ts', ...args],
    {
      env: { ...process.env, ...(privateRoot === undefined ? {} : { RAWENGINE_PRIVATE_RAW_ROOT: privateRoot }) },
      stderr: 'pipe',
      stdout: 'pipe',
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode === 0) throw new Error(`${label}: expected checker to fail.`);
  if (!`${stdout}\n${stderr}`.includes(expected)) {
    throw new Error(`${label}: expected failure containing "${expected}".`);
  }
}

async function writeTempCollection(collection: ComputationalMergePrivateRunReportCollection): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawengine-private-negative-report-'));
  const path = join(directory, 'reports.json');
  await writeFile(path, `${JSON.stringify(collection, null, 2)}\n`);
  return path;
}

function sampleCollection(): ComputationalMergePrivateRunReportCollection {
  const hash = `sha256:${'0'.repeat(64)}`;
  const metric = (name: string, threshold: number) => ({
    name,
    passed: true,
    source: 'private_raw_report',
    threshold,
    value: name === 'previewExportMeanAbsDelta' ? 0 : threshold,
  });
  const qualityMetrics = proofCase.expectedMetrics.map((expectedMetric) =>
    metric(expectedMetric.name, expectedMetric.threshold),
  );
  const previewExportParity = qualityMetrics.find((candidate) => candidate.name === 'previewExportMeanAbsDelta');
  if (previewExportParity === undefined) throw new Error('Missing previewExportMeanAbsDelta fixture metric.');

  return parseComputationalMergePrivateRunReportCollection({
    $schema: 'https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json',
    issue: 1817,
    reports: [
      {
        acceptanceStatus: 'runtime_apply_capable',
        artifacts: proofCase.artifacts.map((artifact) => ({
          hash,
          kind: artifact.kind,
          path: artifact.path,
          publicRepoAllowed: false,
        })),
        commandIds: { apply: 'command_apply', dryRun: 'command_dry_run' },
        featureFamily: proofCase.featureFamily,
        fixtureId: proofCase.fixtureId,
        generatedAt: '2026-06-18T00:00:00.000Z',
        graphRevisionHash: hash,
        implementationIssue: proofCase.implementationIssue,
        notes: 'negative-case fixture',
        previewExportParity,
        qualityMetrics,
        reportId: 'computational-merge-run.hdr-bracket-alignment.v1',
        runtimeResultIds: { apply: 'runtime_apply', dryRun: 'runtime_dry_run' },
        screenshotArtifacts: [
          {
            hash,
            label: 'modal_before_apply',
            path: 'private-artifacts/validation/computational-merge/modal-before.png',
            publicRepoAllowed: false,
          },
          {
            hash,
            label: 'modal_after_apply',
            path: 'private-artifacts/validation/computational-merge/modal-after.png',
            publicRepoAllowed: false,
          },
        ],
        sourceHashes: proofCase.localSourceRelativePaths.map((path, index) => ({
          hash: `sha256:${String(index).repeat(64)}`,
          localRelativePath: path,
          path,
          publicRepoAllowed: false,
        })),
        uiIssue: proofCase.uiIssue,
      },
    ],
    schemaVersion: 1,
    snapshotDate: '2026-06-18',
    validationMode: 'public_schema_private_reports',
  });
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
