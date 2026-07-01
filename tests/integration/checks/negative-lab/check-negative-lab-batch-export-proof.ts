#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { z } from 'zod';

import {
  negativeLabApplyResultV1Schema,
  negativeLabPositiveVariantProvenanceV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleNegativeLabApplyResultV1,
  sampleNegativeLabPositiveVariantProvenanceV1,
} from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  buildNegativeLabAcceptedBatchApplyRouteResult,
  buildNegativeLabAcceptedBatchPlanRouteResult,
} from '../../../../src/utils/negative-lab/app-server/negativeLabAppServerRoutes.ts';
import { NegativeLabOutputFormatId } from '../../../../src/utils/negative-lab/negativeLabOutputFormatIds.ts';

const exportedPositiveSchema = z
  .object({
    conversionBundleContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    conversionBundlePath: z.string().trim().min(1),
    outputContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    outputPath: z.string().trim().min(1),
    provenanceEntryIds: z.array(z.string().trim().min(1)).min(1),
    sidecarContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    sidecarPath: z.string().trim().min(1),
    sourceContentHash: z.string().trim().min(1),
    sourceFrameId: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
  })
  .strict();

const batchExportProofSchema = z
  .object({
    exportedPositives: z.array(exportedPositiveSchema).min(1),
    rejectedFrames: z
      .array(
        z
          .object({
            frameId: z.string().trim().min(1),
            reason: z.enum(['missing_positive_variant', 'source_overwrite_guard', 'unsupported_output_format']),
          })
          .strict(),
      )
      .min(1),
    sidecarContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict()
  .superRefine((proof, context) => {
    for (const [index, positive] of proof.exportedPositives.entries()) {
      if (
        positive.outputPath === positive.sourcePath ||
        basename(positive.outputPath) === basename(positive.sourcePath)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab positive export must not overwrite the source negative.',
          path: ['exportedPositives', index, 'outputPath'],
        });
      }
    }
  });

const hashText = (value: string) => new Bun.CryptoHasher('sha256').update(value).digest('hex');

const applyResult = negativeLabApplyResultV1Schema.parse(sampleNegativeLabApplyResultV1);
const provenance = negativeLabPositiveVariantProvenanceV1Schema.parse(sampleNegativeLabPositiveVariantProvenanceV1);
const acceptedPlan = buildNegativeLabAcceptedBatchPlanRouteResult({
  activePathIndex: 0,
  baseFogConfidence: 0.91,
  includedPaths: ['/photos/roll-01/lab-scan-0001.jpg', '/photos/roll-01/lab-scan-0002.jpg'],
  presetId: 'negative_lab.generic.c41.neutral.v1',
  previewReady: true,
  targetPaths: [
    '/photos/roll-01/lab-scan-0001.jpg',
    '/photos/roll-01/lab-scan-0002.jpg',
    '/photos/roll-01/lab-scan-0003.jpg',
  ],
});
const acceptedApply = buildNegativeLabAcceptedBatchApplyRouteResult({
  acceptedPlan,
  conversion: {
    outputFormat: NegativeLabOutputFormatId.Tiff16,
    paths: acceptedPlan.dryRunSummary.frameHealthReport.frames.map((frame) => frame.sourcePath),
    presetId: 'negative_lab.generic.c41.neutral.v1',
    sampleRect: null,
    scope: 'all',
    suffix: 'Positive',
  },
  dryRun: {
    activePathIndex: 0,
    baseFogConfidence: 0.91,
    includedPaths: ['/photos/roll-01/lab-scan-0001.jpg', '/photos/roll-01/lab-scan-0002.jpg'],
    presetId: 'negative_lab.generic.c41.neutral.v1',
    previewReady: true,
    targetPaths: [
      '/photos/roll-01/lab-scan-0001.jpg',
      '/photos/roll-01/lab-scan-0002.jpg',
      '/photos/roll-01/lab-scan-0003.jpg',
    ],
  },
});
const routePositive = acceptedApply.apply.positiveOutputs.exportedPositives[0];
if (routePositive === undefined) {
  throw new Error('Accepted Negative Lab apply did not return a positive output receipt.');
}
const exportDir = await mkdtemp(join(tmpdir(), 'rawengine-negative-positive-export-'));
await mkdir(exportDir, { recursive: true });

const outputPath = join(exportDir, basename(routePositive.outputPath));
const outputPayload = `${JSON.stringify(
  {
    acceptedDryRunPlanHash: routePositive.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: routePositive.acceptedDryRunPlanId,
    appliedGraphRevision: `${applyResult.appliedGraphRevision}:${acceptedApply.acceptedDryRunPlanId}`,
    outputIntent: provenance.outputIntent,
    profileProvenanceHash: routePositive.profileProvenanceHash,
    sourceContentHash: routePositive.sourceContentHash,
    sourceFrameId: routePositive.frameId,
    variantId: routePositive.positiveVariantId,
  },
  null,
  2,
)}\n`;
await writeFile(outputPath, outputPayload);

const outputContentHash = `sha256:${hashText(await readFile(outputPath, 'utf8'))}`;
const sidecarPayload = {
  exportedPositives: [
    {
      conversionBundleContentHash: routePositive.conversionBundleContentHash,
      conversionBundlePath: routePositive.conversionBundlePath,
      outputContentHash,
      outputPath,
      provenanceEntryIds: routePositive.provenanceEntryIds,
      sidecarContentHash: routePositive.sidecarContentHash,
      sidecarPath: routePositive.sidecarPath,
      sourceContentHash: routePositive.sourceContentHash,
      sourceFrameId: routePositive.frameId,
      sourcePath: routePositive.sourcePath,
      variantId: routePositive.positiveVariantId,
    },
  ],
  rejectedFrames: [{ frameId: 'frame_unsupported_0002', reason: 'missing_positive_variant' }],
};
const sidecarText = `${JSON.stringify(sidecarPayload, null, 2)}\n`;
const proof = batchExportProofSchema.parse({
  ...sidecarPayload,
  sidecarContentHash: `sha256:${hashText(sidecarText)}`,
});

if (
  !acceptedApply.apply.positiveOutputs.exportedPositives.some(
    (positive) => positive.positiveVariantId === proof.exportedPositives[0]?.variantId,
  )
) {
  throw new Error('Negative Lab batch export proof must use a variant created by the accepted apply result.');
}

if (
  applyResult.changeSet.createdPositiveVariantIds.includes(provenance.positiveVariantId) &&
  provenance.provenanceEntryIds.length === 0
) {
  throw new Error('Negative Lab sample provenance fixture is invalid.');
}

console.log(`negative lab batch export proof ok (${proof.exportedPositives.length} positive)`);
