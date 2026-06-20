#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

import { z } from 'zod';

import {
  negativeLabApplyResultV1Schema,
  negativeLabPositiveVariantProvenanceV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleNegativeLabApplyResultV1,
  sampleNegativeLabPositiveVariantProvenanceV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const exportedPositiveSchema = z
  .object({
    outputContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    outputPath: z.string().trim().min(1),
    provenanceEntryIds: z.array(z.string().trim().min(1)).min(1),
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
            reason: z.enum(['missing_positive_variant', 'unsupported_output_format']),
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
const exportDir = await mkdtemp(join(tmpdir(), 'rawengine-negative-positive-export-'));
await mkdir(exportDir, { recursive: true });

const outputPath = join(exportDir, `${provenance.sourceFrameId}-Positive.tif`);
const outputPayload = `${JSON.stringify(
  {
    appliedGraphRevision: applyResult.appliedGraphRevision,
    outputIntent: provenance.outputIntent,
    sourceContentHash: provenance.sourceContentHash,
    sourceFrameId: provenance.sourceFrameId,
    variantId: provenance.positiveVariantId,
  },
  null,
  2,
)}\n`;
await writeFile(outputPath, outputPayload);

const outputContentHash = `sha256:${hashText(await readFile(outputPath, 'utf8'))}`;
const sidecarPayload = {
  exportedPositives: [
    {
      outputContentHash,
      outputPath,
      provenanceEntryIds: provenance.provenanceEntryIds,
      sourceContentHash: provenance.sourceContentHash,
      sourceFrameId: provenance.sourceFrameId,
      sourcePath: '/photos/roll-01/lab-scan-0001.jpg',
      variantId: provenance.positiveVariantId,
    },
  ],
  rejectedFrames: [{ frameId: 'frame_unsupported_0002', reason: 'missing_positive_variant' }],
};
const sidecarText = `${JSON.stringify(sidecarPayload, null, 2)}\n`;
const proof = batchExportProofSchema.parse({
  ...sidecarPayload,
  sidecarContentHash: `sha256:${hashText(sidecarText)}`,
});

if (!applyResult.changeSet.createdPositiveVariantIds.includes(proof.exportedPositives[0]?.variantId ?? '')) {
  throw new Error('Negative Lab batch export proof must use a variant created by the apply result.');
}

console.log(`negative lab batch export proof ok (${proof.exportedPositives.length} positive)`);
