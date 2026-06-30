#!/usr/bin/env bun

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseComputationalMergePrivateRunReportCollection } from '../../../../src/schemas/computational-merge/computationalMergePrivateRunReportSchemas.ts';

const REPORT_ROOT = 'private-artifacts/validation/computational-merge';
const REPORT_SUFFIX = '-private-run-report.json';

const args = new Set(process.argv.slice(2));
const requireRoot = args.has('--require-root');
const selfTest = args.has('--self-test');
const outputPath = valueAfter('--output');
const explicitRoot = valueAfter('--root');

if (selfTest) {
  await runSelfTest();
  process.exit(0);
}

const privateRoot = explicitRoot ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (!privateRoot) {
  if (requireRoot) {
    console.error('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-root.');
    process.exit(1);
  }
  console.log('computational merge private report collection skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)');
  process.exit(0);
}

const collection = await collectPrivateRunReports(privateRoot);
if (outputPath !== undefined) {
  await writeFile(outputPath, `${JSON.stringify(collection, null, 2)}\n`);
}
console.log(`computational merge private reports ok (${collection.reports.length} report(s))`);

async function collectPrivateRunReports(
  privateRoot: string,
): Promise<ReturnType<typeof parseComputationalMergePrivateRunReportCollection>> {
  const reportPaths = await findReportFiles(join(resolve(privateRoot), REPORT_ROOT));
  const reports = [];

  for (const reportPath of reportPaths) {
    const collection = parseComputationalMergePrivateRunReportCollection(
      JSON.parse(await readFile(reportPath, 'utf8')),
    );
    reports.push(...collection.reports);
  }

  return parseComputationalMergePrivateRunReportCollection({
    $schema: 'https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json',
    issue: 1817,
    reports,
    schemaVersion: 1,
    snapshotDate: new Date().toISOString().slice(0, 10),
    validationMode: 'public_schema_private_reports',
  });
}

async function findReportFiles(directory: string): Promise<Array<string>> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const reports: Array<string> = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      reports.push(...(await findReportFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(REPORT_SUFFIX)) {
      reports.push(path);
    }
  }
  return reports.toSorted();
}

async function runSelfTest(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rawengine-computational-private-reports-'));
  try {
    const reportDir = join(root, REPORT_ROOT);
    await mkdir(reportDir, { recursive: true });
    await writeFile(
      join(reportDir, 'hdr-bracket-private-run-report.json'),
      JSON.stringify(sampleCollection(), null, 2),
    );
    const collection = await collectPrivateRunReports(root);
    if (collection.reports.length !== 1) {
      throw new Error(`expected 1 collected report, found ${collection.reports.length}`);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }

  console.log('computational merge private report collector self-test ok');
}

function sampleCollection(): ReturnType<typeof parseComputationalMergePrivateRunReportCollection> {
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

  return parseComputationalMergePrivateRunReportCollection({
    $schema: 'https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json',
    issue: 1817,
    reports: [
      {
        acceptanceStatus: 'runtime_apply_capable',
        artifacts: [
          artifact('source_raw_sequence_private', 'private-fixtures/hdr/bracket-alignment-v1'),
          artifact('alignment_report_private', `${REPORT_ROOT}/hdr-bracket-alignment.json`),
          artifact('merge_output_private', `${REPORT_ROOT}/hdr-bracket-merge.tiff`),
          artifact('preview_after_private', `${REPORT_ROOT}/hdr-bracket-preview.png`),
          artifact('export_after_private', `${REPORT_ROOT}/hdr-bracket-export.tiff`),
          artifact('quality_report_private', `${REPORT_ROOT}/hdr-bracket-quality.json`),
          artifact('app_server_runtime_report_private', `${REPORT_ROOT}/hdr-bracket-app-server-runtime-proof.json`),
        ],
        commandIds: { apply: 'command_hdr_apply', dryRun: 'command_hdr_dry_run' },
        featureFamily: 'hdr_merge',
        fixtureId: 'validation.computational-merge.hdr-bracket-alignment.v1',
        generatedAt: '2026-06-18T00:00:00.000Z',
        graphRevisionHash: hash,
        implementationIssue: 2062,
        notes: 'sample private computational merge run report using runtime apply capability',
        previewExportParity,
        qualityMetrics: [
          metric('exposureBracketCoverageEv', 4, 4),
          metric('highlightRecoveryRatio', 1.1, 1.1),
          metric('ghostSuppressionScore', 0.85, 0.85),
          previewExportParity,
        ],
        reportId: 'computational-merge-run.hdr-bracket-alignment.v1',
        runtimeResultIds: { apply: 'runtime_hdr_apply', dryRun: 'runtime_hdr_dry_run' },
        screenshotArtifacts: [
          { ...asset(`${REPORT_ROOT}/hdr-bracket-modal-before.png`), label: 'modal_before_apply' },
          { ...asset(`${REPORT_ROOT}/hdr-bracket-modal-after.png`), label: 'modal_after_apply' },
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
  });
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
