#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseRawOpenEditExportProofManifest } from '../../../src/schemas/rawOpenEditExportProofSchemas.ts';
import { parseRawOpenEditExportRunReportCollection } from '../../../src/schemas/rawOpenEditExportRunReportSchemas.ts';

const requireAssets = process.argv.includes('--require-assets');
const allowFreshHashes = process.argv.includes('--allow-fresh-hashes');
const fixtureIdFilter = valueAfter('--fixture-id');
const root = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const inputPath = valueAfter('--input') ?? 'fixtures/validation/raw-open-edit-export-run-reports.json';
const failures: string[] = [];

if (requireAssets && root === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets.');
}

const manifest = parseRawOpenEditExportProofManifest(
  JSON.parse(await readFile('fixtures/validation/raw-open-edit-export-proof.json', 'utf8')),
);
const reportCollection = parseRawOpenEditExportRunReportCollection(JSON.parse(await readFile(inputPath, 'utf8')));

const proofCases =
  fixtureIdFilter === undefined
    ? manifest.proofCases
    : manifest.proofCases.filter((proofCase) => proofCase.fixtureId === fixtureIdFilter);
const reports =
  fixtureIdFilter === undefined
    ? reportCollection.reports
    : reportCollection.reports.filter((report) => report.fixtureId === fixtureIdFilter);
const proofCasesByFixtureId = new Map(proofCases.map((proofCase) => [proofCase.fixtureId, proofCase]));
const reportsByFixtureId = new Map(reports.map((report) => [report.fixtureId, report]));

for (const report of reports) {
  const proofCase = proofCasesByFixtureId.get(report.fixtureId);
  if (proofCase === undefined) {
    failures.push(`${report.fixtureId}: private run report has no manifest proof case.`);
    continue;
  }

  if (report.editGraphRevision !== proofCase.editGraphRevision) {
    failures.push(`${report.fixtureId}: edit graph revision must match manifest.`);
  }
  if (report.trackingIssue !== proofCase.trackingIssue) {
    failures.push(`${report.fixtureId}: tracking issue must be #${proofCase.trackingIssue}.`);
  }
  if (report.sourceRaw.path !== proofCase.localRelativePath) {
    failures.push(`${report.fixtureId}: source RAW path must match manifest localRelativePath.`);
  }

  const manifestArtifacts = new Map(proofCase.artifacts.map((artifact) => [artifact.kind, artifact]));
  const reportArtifacts = new Map(report.artifacts.map((artifact) => [artifact.kind, artifact]));
  for (const artifact of report.artifacts) {
    const manifestArtifact = manifestArtifacts.get(artifact.kind);
    if (manifestArtifact === undefined) {
      failures.push(`${report.fixtureId}: unexpected artifact kind ${artifact.kind}.`);
      continue;
    }
    if (artifact.path !== manifestArtifact.path) {
      failures.push(`${report.fixtureId}: ${artifact.kind} path must match manifest.`);
    }
    if (!allowFreshHashes && manifestArtifact.hash !== null && artifact.hash !== manifestArtifact.hash) {
      failures.push(`${report.fixtureId}: ${artifact.kind} hash must match manifest.`);
    }
  }

  if (reportArtifacts.get('source_raw_private')?.path !== report.sourceRaw.path) {
    failures.push(`${report.fixtureId}: sourceRaw must match source_raw_private artifact.`);
  }
  if (reportArtifacts.get('preview_before_private')?.path !== report.previewBefore.path) {
    failures.push(`${report.fixtureId}: previewBefore must match preview_before_private artifact.`);
  }
  if (reportArtifacts.get('preview_after_private')?.path !== report.previewAfter.path) {
    failures.push(`${report.fixtureId}: previewAfter must match preview_after_private artifact.`);
  }
  if (reportArtifacts.get('sidecar_after_private')?.path !== report.sidecarAfter.path) {
    failures.push(`${report.fixtureId}: sidecarAfter must match sidecar_after_private artifact.`);
  }

  const reportMetrics = new Map(report.metrics.map((metric) => [metric.name, metric]));
  for (const expectedMetric of proofCase.expectedMetrics) {
    const reportMetric = reportMetrics.get(expectedMetric.name);
    if (reportMetric === undefined) {
      failures.push(`${report.fixtureId}: missing manifest metric ${expectedMetric.name}.`);
      continue;
    }
    if (reportMetric.threshold !== expectedMetric.threshold) {
      failures.push(`${report.fixtureId}: ${expectedMetric.name} threshold must match manifest.`);
    }
  }

  const changedPixelMetric = reportMetrics.get('changedPixelRatio');
  if (changedPixelMetric === undefined || changedPixelMetric.value <= 0) {
    failures.push(`${report.fixtureId}: changedPixelRatio must be greater than zero.`);
  }

  if (requireAssets && root !== undefined) {
    await verifyPrivateAssets(root, report.fixtureId, [
      report.sourceRaw,
      report.previewBefore,
      report.previewAfter,
      report.sidecarAfter,
      ...report.artifacts,
    ]);
  }
}

for (const proofCase of proofCases) {
  const report = reportsByFixtureId.get(proofCase.fixtureId);

  if (requireAssets && report === undefined) {
    failures.push(`${proofCase.fixtureId}: --require-assets requires a private run report.`);
  }

  if (proofCase.status === 'accepted_private_asset' && report === undefined) {
    failures.push(`${proofCase.fixtureId}: accepted private RAW proof requires a private run report.`);
  }
}

async function verifyPrivateAssets(
  privateRoot: string,
  fixtureId: string,
  assets: Array<{ hash: string; path: string }>,
): Promise<void> {
  const seenPaths = new Set<string>();
  for (const asset of assets) {
    if (seenPaths.has(asset.path)) {
      continue;
    }
    seenPaths.add(asset.path);

    const absolutePath = resolve(privateRoot, asset.path);
    try {
      await access(absolutePath);
    } catch {
      failures.push(`${fixtureId}: missing private run artifact ${asset.path}.`);
      continue;
    }

    const actualHash = createHash('sha256')
      .update(await readFile(absolutePath))
      .digest('hex');
    if (`sha256:${actualHash}` !== asset.hash) {
      failures.push(`${fixtureId}: hash mismatch for ${asset.path}.`);
    }
  }
}

if (failures.length > 0) {
  console.error('RAW open/edit/export run reports failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

const mode =
  reports.length === 0 ? 'public schema mode; no private reports committed' : `${reports.length} private report(s)`;
console.log(`raw open/edit/export run reports ok (${mode})`);

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
