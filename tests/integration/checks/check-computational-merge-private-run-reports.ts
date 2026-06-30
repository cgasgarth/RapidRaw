#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { parseComputationalMergeE2eProofManifest } from '../../../src/schemas/computationalMergeE2eProofSchemas.ts';
import { parseComputationalMergePrivateRunReportCollection } from '../../../src/schemas/computationalMergePrivateRunReportSchemas.ts';

const requireAssets = process.argv.includes('--require-assets');
const inputPath = valueAfter('--input');
const fixtureId = valueAfter('--fixture-id');
const requiredRunId = valueAfter('--require-run-id');
const root = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const failures: string[] = [];

if (inputPath === undefined) {
  failures.push(
    'Missing --input <path>. Generate a private run report first; committed run-report fixtures are not used.',
  );
}
if (requireAssets && root === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets.');
}

const manifest = parseComputationalMergeE2eProofManifest(
  JSON.parse(await readFile('fixtures/validation/app-server/computational-merge-e2e-proof.json', 'utf8')),
);
const reportCollection =
  inputPath === undefined
    ? parseComputationalMergePrivateRunReportCollection({
        $schema: 'https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json',
        issue: 1809,
        reports: [],
        schemaVersion: 1,
        snapshotDate: '1970-01-01',
        validationMode: 'public_schema_private_reports',
      })
    : parseComputationalMergePrivateRunReportCollection(JSON.parse(await readFile(inputPath, 'utf8')));

const proofCasesByFixtureId = new Map(manifest.proofCases.map((proofCase) => [proofCase.fixtureId, proofCase]));
const reportsByFixtureId = new Map(reportCollection.reports.map((report) => [report.fixtureId, report]));
const selectedProofCases =
  fixtureId === undefined
    ? manifest.proofCases
    : manifest.proofCases.filter((proofCase) => proofCase.fixtureId === fixtureId);

if (fixtureId !== undefined && selectedProofCases.length === 0) {
  failures.push(`${fixtureId}: unknown computational merge proof fixture.`);
}

for (const report of reportCollection.reports) {
  if (fixtureId !== undefined && report.fixtureId !== fixtureId) continue;

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
  if (requiredRunId !== undefined && report.runId !== requiredRunId) {
    failures.push(`${report.fixtureId}: runId must match current private proof invocation.`);
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
  const decodeSmoke =
    report.acceptanceStatus === 'private_decode_smoke' &&
    (report.featureFamily === 'panorama_stitch' ||
      report.featureFamily === 'focus_stack' ||
      report.featureFamily === 'super_resolution');
  const alignmentSmoke =
    report.acceptanceStatus === 'private_alignment_smoke' && report.featureFamily === 'panorama_stitch';
  const stitchArtifactSmoke =
    report.acceptanceStatus === 'private_stitch_artifact_smoke' && report.featureFamily === 'panorama_stitch';
  const previewExportSmoke =
    report.acceptanceStatus === 'private_preview_export_smoke' &&
    (report.featureFamily === 'hdr_merge' ||
      report.featureFamily === 'panorama_stitch' ||
      report.featureFamily === 'focus_stack' ||
      report.featureFamily === 'super_resolution');
  const reconstructionArtifactSmoke =
    report.acceptanceStatus === 'private_reconstruction_artifact_smoke' && report.featureFamily === 'super_resolution';
  const focusStackArtifactSmoke =
    report.acceptanceStatus === 'private_focus_stack_artifact_smoke' && report.featureFamily === 'focus_stack';
  if (decodeSmoke) {
    verifyDecodeSmokeReport(report, proofCase.localSourceRelativePaths.length);
  } else if (alignmentSmoke) {
    verifyAlignmentSmokeReport(report, proofCase.localSourceRelativePaths.length);
  } else if (stitchArtifactSmoke) {
    verifyStitchArtifactSmokeReport(report, proofCase.localSourceRelativePaths.length);
  } else if (previewExportSmoke) {
    verifyPreviewExportSmokeReport(report, proofCase.localSourceRelativePaths.length);
  } else if (reconstructionArtifactSmoke) {
    verifyReconstructionArtifactSmokeReport(report, proofCase.localSourceRelativePaths.length);
  } else if (focusStackArtifactSmoke) {
    verifyFocusStackArtifactSmokeReport(report, proofCase.localSourceRelativePaths.length);
  } else {
    const requiresPreviewExportParity =
      report.acceptanceStatus === 'passed_private_raw_e2e' ||
      report.featureFamily === 'hdr_merge' ||
      report.featureFamily === 'panorama_stitch';
    const optionalExtraArtifactKinds = new Set(['decode_report_private']);
    for (const artifact of report.artifacts) {
      const manifestArtifact = manifestArtifacts.get(artifact.kind);
      if (manifestArtifact === undefined) {
        if (!optionalExtraArtifactKinds.has(artifact.kind)) {
          failures.push(`${report.fixtureId}: unexpected artifact kind ${artifact.kind}.`);
        }
        continue;
      }
      if (artifact.path !== manifestArtifact.path) {
        failures.push(`${report.fixtureId}: ${artifact.kind} path must match manifest artifact path.`);
      }
    }
    for (const requiredArtifactKind of [
      'source_raw_sequence_private',
      'alignment_report_private',
      'merge_output_private',
      'quality_report_private',
      'app_server_runtime_report_private',
      ...(requiresPreviewExportParity ? (['preview_after_private', 'export_after_private'] as const) : []),
    ] as const) {
      if (!report.artifacts.some((artifact) => artifact.kind === requiredArtifactKind)) {
        failures.push(`${report.fixtureId}: runtime report missing ${requiredArtifactKind}.`);
      }
    }

    const reportMetrics = new Map(report.qualityMetrics.map((metric) => [metric.name, metric]));
    for (const expectedMetric of proofCase.expectedMetrics) {
      if (!requiresPreviewExportParity && expectedMetric.name === 'previewExportMeanAbsDelta') continue;
      const reportMetric = reportMetrics.get(expectedMetric.name);
      if (reportMetric === undefined) {
        failures.push(`${report.fixtureId}: missing required quality metric ${expectedMetric.name}.`);
        continue;
      }
      if (reportMetric.threshold !== expectedMetric.threshold) {
        failures.push(`${report.fixtureId}: ${expectedMetric.name} threshold must match manifest.`);
      }
      if (!metricPassesThreshold(reportMetric.name, reportMetric.value, reportMetric.threshold)) {
        failures.push(`${report.fixtureId}: ${expectedMetric.name} value must satisfy threshold.`);
      }
    }

    if (requiresPreviewExportParity && !reportMetrics.has('previewExportMeanAbsDelta')) {
      failures.push(`${report.fixtureId}: missing preview/export parity metric.`);
    }
  }

  const sourceHashes = report.sourceHashes.map((sourceHash) => sourceHash.hash);
  if (new Set(sourceHashes).size !== sourceHashes.length) {
    failures.push(`${report.fixtureId}: source hashes must be unique; duplicate bytes are not accepted.`);
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

for (const proofCase of selectedProofCases) {
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

    const privateRootPath = await realpath(privateRoot);
    const absolutePath = resolve(privateRootPath, asset.path);
    try {
      await access(absolutePath);
    } catch {
      failures.push(`${fixtureId}: missing private run artifact ${asset.path}.`);
      continue;
    }
    const resolvedPath = await realpath(absolutePath);
    if (!isWithinRoot(privateRootPath, resolvedPath) && !asset.path.startsWith('private-fixtures/')) {
      failures.push(`${fixtureId}: private run artifact escapes private root: ${asset.path}.`);
      continue;
    }

    const actualHash = await hashPrivatePath(absolutePath);
    if (`sha256:${actualHash}` !== asset.hash) {
      failures.push(`${fixtureId}: hash mismatch for ${asset.path}.`);
    }
  }
}

function metricPassesThreshold(name: string, value: number, threshold: number): boolean {
  if (
    name === 'previewExportMeanAbsDelta' ||
    name === 'focusTransitionArtifactScore' ||
    name === 'alignmentMeanReprojectionErrorPx' ||
    name === 'alignmentRejectedPairCount' ||
    name === 'panoramaExcludedSourceCount' ||
    name === 'superResolutionArtifactScore' ||
    name === 'superResolutionRegistrationResidualPx' ||
    name === 'focusStackLowConfidenceCellRatio'
  ) {
    return value <= threshold;
  }
  return value >= threshold;
}

function verifyFocusStackArtifactSmokeReport(
  report: NonNullable<ReturnType<typeof parseComputationalMergePrivateRunReportCollection>['reports'][number]>,
  expectedSourceCount: number,
  options: { allowPreviewExport?: boolean } = {},
): void {
  const artifactKinds = new Set(report.artifacts.map((artifact) => artifact.kind));
  for (const requiredKind of [
    'source_raw_sequence_private',
    'decode_report_private',
    'alignment_report_private',
    'merge_output_private',
    'quality_report_private',
  ]) {
    if (!artifactKinds.has(requiredKind)) {
      failures.push(`${report.fixtureId}: focus stack artifact smoke missing ${requiredKind}.`);
    }
  }
  for (const forbiddenKind of ['preview_after_private', 'export_after_private']) {
    if (options.allowPreviewExport === true) continue;
    if (artifactKinds.has(forbiddenKind)) {
      failures.push(`${report.fixtureId}: focus stack artifact smoke must not claim ${forbiddenKind}.`);
    }
  }

  const reportMetrics = new Map(report.qualityMetrics.map((metric) => [metric.name, metric]));
  const decodedSourceCount = reportMetrics.get('decodedSourceCount');
  const decodedFinitePixelRatio = reportMetrics.get('decodedFinitePixelRatio');
  const winnerSourceCount = reportMetrics.get('focusStackWinnerSourceCount');
  const sourceCoverageRatio = reportMetrics.get('focusStackSourceCoverageRatio');
  const outputPixelCount = reportMetrics.get('focusStackOutputPixelCount');
  const sharpnessGainRatio = reportMetrics.get('sharpnessGainRatio');
  const transitionArtifactScore = reportMetrics.get('focusTransitionArtifactScore');
  const lowConfidenceCellRatio = reportMetrics.get('focusStackLowConfidenceCellRatio');

  if (decodedSourceCount === undefined || decodedSourceCount.value < expectedSourceCount) {
    failures.push(
      `${report.fixtureId}: focus stack artifact smoke must prove decodedSourceCount >= ${expectedSourceCount}.`,
    );
  }
  if (decodedFinitePixelRatio === undefined || decodedFinitePixelRatio.value < 1) {
    failures.push(`${report.fixtureId}: focus stack artifact smoke must prove decodedFinitePixelRatio >= 1.`);
  }
  if (winnerSourceCount === undefined || winnerSourceCount.value < 2) {
    failures.push(`${report.fixtureId}: focus stack artifact smoke must prove at least two winning sources.`);
  }
  if (
    sourceCoverageRatio === undefined ||
    !metricPassesThreshold(sourceCoverageRatio.name, sourceCoverageRatio.value, sourceCoverageRatio.threshold)
  ) {
    failures.push(`${report.fixtureId}: focus stack artifact smoke must prove source coverage ratio meets threshold.`);
  }
  if (outputPixelCount === undefined || outputPixelCount.value <= 0) {
    failures.push(`${report.fixtureId}: focus stack artifact smoke must prove nonzero output pixels.`);
  }
  if (
    sharpnessGainRatio === undefined ||
    !metricPassesThreshold(sharpnessGainRatio.name, sharpnessGainRatio.value, sharpnessGainRatio.threshold)
  ) {
    failures.push(`${report.fixtureId}: focus stack artifact smoke must prove sharpnessGainRatio threshold.`);
  }
  if (
    transitionArtifactScore === undefined ||
    !metricPassesThreshold(
      transitionArtifactScore.name,
      transitionArtifactScore.value,
      transitionArtifactScore.threshold,
    )
  ) {
    failures.push(`${report.fixtureId}: focus stack artifact smoke must prove transition artifact threshold.`);
  }
  if (
    lowConfidenceCellRatio === undefined ||
    !metricPassesThreshold(lowConfidenceCellRatio.name, lowConfidenceCellRatio.value, lowConfidenceCellRatio.threshold)
  ) {
    failures.push(`${report.fixtureId}: focus stack artifact smoke must prove low confidence cell ratio threshold.`);
  }
}

function verifyDecodeSmokeReport(
  report: NonNullable<ReturnType<typeof parseComputationalMergePrivateRunReportCollection>['reports'][number]>,
  expectedSourceCount: number,
): void {
  const artifactKinds = new Set(report.artifacts.map((artifact) => artifact.kind));
  for (const requiredKind of ['source_raw_sequence_private', 'decode_report_private', 'quality_report_private']) {
    if (!artifactKinds.has(requiredKind)) failures.push(`${report.fixtureId}: decode smoke missing ${requiredKind}.`);
  }
  for (const forbiddenKind of ['merge_output_private', 'preview_after_private', 'export_after_private']) {
    if (artifactKinds.has(forbiddenKind)) {
      failures.push(`${report.fixtureId}: decode smoke must not claim ${forbiddenKind}.`);
    }
  }

  const reportMetrics = new Map(report.qualityMetrics.map((metric) => [metric.name, metric]));
  const decodedSourceCount = reportMetrics.get('decodedSourceCount');
  const decodedFinitePixelRatio = reportMetrics.get('decodedFinitePixelRatio');
  const decodedNonzeroDimensionCount = reportMetrics.get('decodedNonzeroDimensionCount');
  if (decodedSourceCount === undefined || decodedSourceCount.value < expectedSourceCount) {
    failures.push(`${report.fixtureId}: decode smoke must prove decodedSourceCount >= ${expectedSourceCount}.`);
  }
  if (decodedFinitePixelRatio === undefined || decodedFinitePixelRatio.value < 1) {
    failures.push(`${report.fixtureId}: decode smoke must prove decodedFinitePixelRatio >= 1.`);
  }
  if (decodedNonzeroDimensionCount === undefined || decodedNonzeroDimensionCount.value < expectedSourceCount) {
    failures.push(
      `${report.fixtureId}: decode smoke must prove decodedNonzeroDimensionCount >= ${expectedSourceCount}.`,
    );
  }
}

function verifyAlignmentSmokeReport(
  report: NonNullable<ReturnType<typeof parseComputationalMergePrivateRunReportCollection>['reports'][number]>,
  expectedSourceCount: number,
  options: { allowMergeOutput?: boolean } = {},
): void {
  const artifactKinds = new Set(report.artifacts.map((artifact) => artifact.kind));
  for (const requiredKind of [
    'source_raw_sequence_private',
    'decode_report_private',
    'alignment_report_private',
    'quality_report_private',
  ]) {
    if (!artifactKinds.has(requiredKind))
      failures.push(`${report.fixtureId}: alignment smoke missing ${requiredKind}.`);
  }
  for (const forbiddenKind of ['merge_output_private', 'preview_after_private', 'export_after_private']) {
    if (forbiddenKind === 'merge_output_private' && options.allowMergeOutput === true) continue;
    if (artifactKinds.has(forbiddenKind)) {
      failures.push(`${report.fixtureId}: alignment smoke must not claim ${forbiddenKind}.`);
    }
  }

  const expectedPairCount = Math.max(0, expectedSourceCount - 1);
  const reportMetrics = new Map(report.qualityMetrics.map((metric) => [metric.name, metric]));
  const decodedSourceCount = reportMetrics.get('decodedSourceCount');
  const decodedFinitePixelRatio = reportMetrics.get('decodedFinitePixelRatio');
  const alignmentMatchCount = reportMetrics.get('alignmentMatchCount');
  const alignmentInlierCount = reportMetrics.get('alignmentInlierCount');
  const alignmentInlierRatio = reportMetrics.get('alignmentInlierRatio');
  const alignmentAcceptedPairCount = reportMetrics.get('alignmentAcceptedPairCount');
  const alignmentRejectedPairCount = reportMetrics.get('alignmentRejectedPairCount');
  const alignmentFiniteTransformCount = reportMetrics.get('alignmentFiniteTransformCount');
  const alignmentMeanReprojectionErrorPx = reportMetrics.get('alignmentMeanReprojectionErrorPx');

  if (decodedSourceCount === undefined || decodedSourceCount.value < expectedSourceCount) {
    failures.push(`${report.fixtureId}: alignment smoke must prove decodedSourceCount >= ${expectedSourceCount}.`);
  }
  if (decodedFinitePixelRatio === undefined || decodedFinitePixelRatio.value < 1) {
    failures.push(`${report.fixtureId}: alignment smoke must prove decodedFinitePixelRatio >= 1.`);
  }
  if (alignmentMatchCount === undefined || alignmentMatchCount.value <= 0) {
    failures.push(`${report.fixtureId}: alignment smoke must prove alignmentMatchCount > 0.`);
  }
  if (alignmentInlierCount === undefined || alignmentInlierCount.value <= 0) {
    failures.push(`${report.fixtureId}: alignment smoke must prove alignmentInlierCount > 0.`);
  }
  if (
    alignmentInlierRatio === undefined ||
    !metricPassesThreshold(alignmentInlierRatio.name, alignmentInlierRatio.value, alignmentInlierRatio.threshold)
  ) {
    failures.push(`${report.fixtureId}: alignment smoke must prove alignmentInlierRatio meets threshold.`);
  }
  if (alignmentAcceptedPairCount === undefined || alignmentAcceptedPairCount.value < expectedPairCount) {
    failures.push(
      `${report.fixtureId}: alignment smoke must prove alignmentAcceptedPairCount >= ${expectedPairCount}.`,
    );
  }
  if (alignmentRejectedPairCount === undefined || alignmentRejectedPairCount.value > 0) {
    failures.push(`${report.fixtureId}: alignment smoke must prove alignmentRejectedPairCount <= 0.`);
  }
  if (alignmentFiniteTransformCount === undefined || alignmentFiniteTransformCount.value < expectedPairCount) {
    failures.push(
      `${report.fixtureId}: alignment smoke must prove alignmentFiniteTransformCount >= ${expectedPairCount}.`,
    );
  }
  if (
    alignmentMeanReprojectionErrorPx === undefined ||
    !metricPassesThreshold(
      alignmentMeanReprojectionErrorPx.name,
      alignmentMeanReprojectionErrorPx.value,
      alignmentMeanReprojectionErrorPx.threshold,
    )
  ) {
    failures.push(`${report.fixtureId}: alignment smoke must prove bounded mean reprojection error.`);
  }
}

function verifyStitchArtifactSmokeReport(
  report: NonNullable<ReturnType<typeof parseComputationalMergePrivateRunReportCollection>['reports'][number]>,
  expectedSourceCount: number,
  options: { allowPreviewExport?: boolean } = {},
): void {
  const artifactKinds = new Set(report.artifacts.map((artifact) => artifact.kind));
  for (const requiredKind of [
    'source_raw_sequence_private',
    'decode_report_private',
    'alignment_report_private',
    'merge_output_private',
    'quality_report_private',
  ]) {
    if (!artifactKinds.has(requiredKind)) {
      failures.push(`${report.fixtureId}: stitch artifact smoke missing ${requiredKind}.`);
    }
  }
  for (const forbiddenKind of ['preview_after_private', 'export_after_private']) {
    if (options.allowPreviewExport === true) continue;
    if (artifactKinds.has(forbiddenKind)) {
      failures.push(`${report.fixtureId}: stitch artifact smoke must not claim ${forbiddenKind}.`);
    }
  }

  verifyAlignmentSmokeReport(report, expectedSourceCount, { allowMergeOutput: true });
  const expectedPairCount = Math.max(0, expectedSourceCount - 1);
  const reportMetrics = new Map(report.qualityMetrics.map((metric) => [metric.name, metric]));
  const stitchedSourceCount = reportMetrics.get('panoramaStitchedSourceCount');
  const excludedSourceCount = reportMetrics.get('panoramaExcludedSourceCount');
  const sourceCoverageRatio = reportMetrics.get('panoramaOutputSourceCoverageRatio');
  const outputPixelCount = reportMetrics.get('panoramaOutputPixelCount');
  const pairwiseMatchCount = reportMetrics.get('panoramaPairwiseMatchCount');

  if (stitchedSourceCount === undefined || stitchedSourceCount.value < expectedSourceCount) {
    failures.push(`${report.fixtureId}: stitch artifact smoke must prove all sources stitched.`);
  }
  if (excludedSourceCount === undefined || excludedSourceCount.value > 0) {
    failures.push(`${report.fixtureId}: stitch artifact smoke must prove no excluded sources.`);
  }
  if (
    sourceCoverageRatio === undefined ||
    !metricPassesThreshold(sourceCoverageRatio.name, sourceCoverageRatio.value, sourceCoverageRatio.threshold)
  ) {
    failures.push(`${report.fixtureId}: stitch artifact smoke must prove source coverage ratio meets threshold.`);
  }
  if (outputPixelCount === undefined || outputPixelCount.value <= 0) {
    failures.push(`${report.fixtureId}: stitch artifact smoke must prove nonzero output pixels.`);
  }
  if (pairwiseMatchCount === undefined || pairwiseMatchCount.value < expectedPairCount) {
    failures.push(
      `${report.fixtureId}: stitch artifact smoke must prove pairwise match count >= ${expectedPairCount}.`,
    );
  }
}

function verifyPreviewExportSmokeReport(
  report: NonNullable<ReturnType<typeof parseComputationalMergePrivateRunReportCollection>['reports'][number]>,
  expectedSourceCount: number,
): void {
  if (report.featureFamily === 'hdr_merge') {
    verifyHdrPreviewExportSmokeReport(report, expectedSourceCount);
  } else if (report.featureFamily === 'panorama_stitch') {
    verifyStitchArtifactSmokeReport(report, expectedSourceCount, { allowPreviewExport: true });
  } else if (report.featureFamily === 'focus_stack') {
    verifyFocusStackArtifactSmokeReport(report, expectedSourceCount, { allowPreviewExport: true });
  } else if (report.featureFamily === 'super_resolution') {
    verifyReconstructionArtifactSmokeReport(report, expectedSourceCount, { allowPreviewExport: true });
  }
  const artifactKinds = new Set(report.artifacts.map((artifact) => artifact.kind));
  for (const requiredKind of ['preview_after_private', 'export_after_private']) {
    if (!artifactKinds.has(requiredKind)) {
      failures.push(`${report.fixtureId}: preview/export smoke missing ${requiredKind}.`);
    }
  }

  const previewExportParity = report.qualityMetrics.find((metric) => metric.name === 'previewExportMeanAbsDelta');
  if (
    previewExportParity === undefined ||
    !metricPassesThreshold(previewExportParity.name, previewExportParity.value, previewExportParity.threshold)
  ) {
    failures.push(`${report.fixtureId}: preview/export smoke must prove previewExportMeanAbsDelta threshold.`);
  }
}

function verifyHdrPreviewExportSmokeReport(
  report: NonNullable<ReturnType<typeof parseComputationalMergePrivateRunReportCollection>['reports'][number]>,
  expectedSourceCount: number,
): void {
  const artifactKinds = new Set(report.artifacts.map((artifact) => artifact.kind));
  for (const requiredKind of [
    'source_raw_sequence_private',
    'decode_report_private',
    'alignment_report_private',
    'merge_output_private',
    'quality_report_private',
  ]) {
    if (!artifactKinds.has(requiredKind)) {
      failures.push(`${report.fixtureId}: HDR preview/export smoke missing ${requiredKind}.`);
    }
  }

  const reportMetrics = new Map(report.qualityMetrics.map((metric) => [metric.name, metric]));
  const requiredMetrics = [
    reportMetrics.get('exposureBracketCoverageEv'),
    reportMetrics.get('highlightRecoveryRatio'),
    reportMetrics.get('ghostSuppressionScore'),
  ];
  if (report.sourceHashes.length < expectedSourceCount) {
    failures.push(`${report.fixtureId}: HDR preview/export smoke must include all source hashes.`);
  }
  for (const requiredMetric of requiredMetrics) {
    if (
      requiredMetric === undefined ||
      !metricPassesThreshold(requiredMetric.name, requiredMetric.value, requiredMetric.threshold)
    ) {
      failures.push(`${report.fixtureId}: HDR preview/export smoke metric failed threshold.`);
    }
  }
}

function verifyReconstructionArtifactSmokeReport(
  report: NonNullable<ReturnType<typeof parseComputationalMergePrivateRunReportCollection>['reports'][number]>,
  expectedSourceCount: number,
  options: { allowPreviewExport?: boolean } = {},
): void {
  const artifactKinds = new Set(report.artifacts.map((artifact) => artifact.kind));
  for (const requiredKind of [
    'source_raw_sequence_private',
    'decode_report_private',
    'alignment_report_private',
    'merge_output_private',
    'quality_report_private',
  ]) {
    if (!artifactKinds.has(requiredKind)) {
      failures.push(`${report.fixtureId}: reconstruction artifact smoke missing ${requiredKind}.`);
    }
  }
  for (const forbiddenKind of ['preview_after_private', 'export_after_private']) {
    if (options.allowPreviewExport === true) continue;
    if (artifactKinds.has(forbiddenKind)) {
      failures.push(`${report.fixtureId}: reconstruction artifact smoke must not claim ${forbiddenKind}.`);
    }
  }

  const reportMetrics = new Map(report.qualityMetrics.map((metric) => [metric.name, metric]));
  const decodedSourceCount = reportMetrics.get('decodedSourceCount');
  const decodedFinitePixelRatio = reportMetrics.get('decodedFinitePixelRatio');
  const requiredMetrics = [
    reportMetrics.get('superResolutionDetailGainRatio'),
    reportMetrics.get('superResolutionOutputPixelCount'),
    reportMetrics.get('superResolutionSourceCoverageRatio'),
    reportMetrics.get('superResolutionArtifactScore'),
    reportMetrics.get('superResolutionRegistrationResidualPx'),
  ];

  if (decodedSourceCount === undefined || decodedSourceCount.value < expectedSourceCount) {
    failures.push(`${report.fixtureId}: reconstruction smoke must prove decodedSourceCount >= ${expectedSourceCount}.`);
  }
  if (decodedFinitePixelRatio === undefined || decodedFinitePixelRatio.value < 1) {
    failures.push(`${report.fixtureId}: reconstruction smoke must prove decodedFinitePixelRatio >= 1.`);
  }
  for (const requiredMetric of requiredMetrics) {
    if (
      requiredMetric === undefined ||
      !metricPassesThreshold(requiredMetric.name, requiredMetric.value, requiredMetric.threshold)
    ) {
      failures.push(`${report.fixtureId}: reconstruction smoke metric failed threshold.`);
    }
  }
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith('/'));
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
    } else if (entry.isSymbolicLink()) {
      const linkedStat = await stat(path);
      if (linkedStat.isFile()) files.push(path);
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
