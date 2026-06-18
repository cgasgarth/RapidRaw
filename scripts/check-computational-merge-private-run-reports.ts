#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { parseComputationalMergeE2eProofManifest } from '../src/schemas/computationalMergeE2eProofSchemas.ts';
import { parseComputationalMergePrivateRunReportCollection } from '../src/schemas/computationalMergePrivateRunReportSchemas.ts';

const requireAssets = process.argv.includes('--require-assets');
const inputPath = valueAfter('--input') ?? 'fixtures/validation/computational-merge-private-run-reports.json';
const root = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const failures: string[] = [];

if (requireAssets && root === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets.');
}

const manifest = parseComputationalMergeE2eProofManifest(
  JSON.parse(await readFile('fixtures/validation/computational-merge-e2e-proof.json', 'utf8')),
);
const reportCollection = parseComputationalMergePrivateRunReportCollection(
  JSON.parse(await readFile(inputPath, 'utf8')),
);

const proofCasesByFixtureId = new Map(manifest.proofCases.map((proofCase) => [proofCase.fixtureId, proofCase]));
const reportsByFixtureId = new Map(reportCollection.reports.map((report) => [report.fixtureId, report]));

for (const report of reportCollection.reports) {
  const proofCase = proofCasesByFixtureId.get(report.fixtureId);
  if (proofCase === undefined) {
    failures.push(`${report.fixtureId}: private run report has no manifest proof case.`);
    continue;
  }

  if (report.featureFamily !== proofCase.featureFamily) {
    failures.push(`${report.fixtureId}: feature family must be ${proofCase.featureFamily}.`);
  }
  if (report.implementationIssue !== proofCase.implementationIssue) {
    failures.push(`${report.fixtureId}: implementation issue must be #${proofCase.implementationIssue}.`);
  }
  if (report.uiIssue !== proofCase.uiIssue) {
    failures.push(`${report.fixtureId}: UI issue must be #${proofCase.uiIssue}.`);
  }

  const sourcePaths = new Set(proofCase.localSourceRelativePaths);
  for (const sourceHash of report.sourceHashes) {
    if (!sourcePaths.has(sourceHash.localRelativePath)) {
      failures.push(`${report.fixtureId}: unexpected source hash path ${sourceHash.localRelativePath}.`);
    }
  }
  if (report.sourceHashes.length !== proofCase.localSourceRelativePaths.length) {
    failures.push(`${report.fixtureId}: source hash count must match manifest source count.`);
  }

  const manifestArtifacts = new Map(proofCase.artifacts.map((artifact) => [artifact.kind, artifact]));
  for (const artifact of report.artifacts) {
    const manifestArtifact = manifestArtifacts.get(artifact.kind);
    if (manifestArtifact === undefined) {
      failures.push(`${report.fixtureId}: unexpected artifact kind ${artifact.kind}.`);
      continue;
    }
    if (artifact.path !== manifestArtifact.path) {
      failures.push(`${report.fixtureId}: ${artifact.kind} path must match manifest artifact path.`);
    }
  }
  if (report.artifacts.length !== proofCase.artifacts.length) {
    failures.push(`${report.fixtureId}: artifact count must match manifest artifact count.`);
  }

  const reportMetrics = new Map(report.qualityMetrics.map((metric) => [metric.name, metric]));
  for (const expectedMetric of proofCase.expectedMetrics) {
    const reportMetric = reportMetrics.get(expectedMetric.name);
    if (reportMetric === undefined) {
      failures.push(`${report.fixtureId}: missing required quality metric ${expectedMetric.name}.`);
      continue;
    }
    if (reportMetric.threshold !== expectedMetric.threshold) {
      failures.push(`${report.fixtureId}: ${expectedMetric.name} threshold must match manifest.`);
    }
  }

  if (!reportMetrics.has('previewExportMeanAbsDelta')) {
    failures.push(`${report.fixtureId}: missing preview/export parity metric.`);
  }

  if (requireAssets && root !== undefined) {
    await verifyPrivateAssets(root, report.fixtureId, [
      ...report.sourceHashes.map((sourceHash) => ({
        hash: sourceHash.hash,
        path: sourceHash.localRelativePath,
      })),
      ...report.artifacts,
      ...report.screenshotArtifacts,
    ]);
  }
}

for (const proofCase of manifest.proofCases) {
  const report = reportsByFixtureId.get(proofCase.fixtureId);

  if (requireAssets && report === undefined) {
    failures.push(`${proofCase.fixtureId}: --require-assets requires a private run report.`);
  }

  if (proofCase.proofStatus !== 'manifest_only' && report === undefined) {
    failures.push(`${proofCase.fixtureId}: non-manifest proof status requires a private run report.`);
    continue;
  }

  if (
    proofCase.proofStatus === 'e2e_verified_private_assets' &&
    report?.acceptanceStatus !== 'passed_private_raw_e2e'
  ) {
    failures.push(`${proofCase.fixtureId}: E2E-verified proof requires passed_private_raw_e2e acceptance.`);
  }
}

async function verifyPrivateAssets(
  privateRoot: string,
  fixtureId: string,
  assets: Array<{ hash: string; path: string }>,
): Promise<void> {
  const seenPaths = new Set<string>();
  for (const asset of assets) {
    if (seenPaths.has(asset.path)) continue;
    seenPaths.add(asset.path);

    const absolutePath = resolve(privateRoot, asset.path);
    try {
      await access(absolutePath);
    } catch {
      failures.push(`${fixtureId}: missing private run artifact ${asset.path}.`);
      continue;
    }

    const actualHash = await hashPrivatePath(absolutePath);
    if (`sha256:${actualHash}` !== asset.hash) {
      failures.push(`${fixtureId}: hash mismatch for ${asset.path}.`);
    }
  }
}

async function hashPrivatePath(path: string): Promise<string> {
  const fileStat = await stat(path);
  if (!fileStat.isDirectory())
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex');

  const filePaths = await collectDirectoryFiles(path);
  const hash = createHash('sha256');
  for (const filePath of filePaths) {
    hash.update(relative(path, filePath).split('/').join('/'));
    hash.update(await readFile(filePath));
  }
  return hash.digest('hex');
}

async function collectDirectoryFiles(directory: string): Promise<Array<string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Array<string> = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectDirectoryFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.toSorted();
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (failures.length > 0) {
  console.error('Computational merge private run reports failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

const mode =
  reportCollection.reports.length === 0
    ? 'public schema mode; no private reports committed'
    : `${reportCollection.reports.length} private report(s)`;
console.log(`computational merge private run reports ok (${mode})`);
