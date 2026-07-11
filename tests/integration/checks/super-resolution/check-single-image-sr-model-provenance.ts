#!/usr/bin/env bun

import { z } from 'zod';

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    capability: z.literal('disabled_pending_weight_redistribution_verification'),
    upstream: z.object({
      repository: z.string().url(),
      commit: z.string().regex(/^[0-9a-f]{40}$/),
      codeLicense: z.literal('Apache-2.0'),
    }),
    checkpoint: z.object({
      name: z.string().min(1),
      url: z.string().url(),
      sizeBytes: z.literal(67277475),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      weightLicense: z.null(),
      redistributionApproved: z.literal(false),
      licenseFinding: z.string().min(80),
    }),
    architecture: z
      .object({
        upscale: z.literal(2),
        windowSize: z.literal(8),
        embedDim: z.literal(180),
        depths: z.tuple([z.literal(6), z.literal(6), z.literal(6), z.literal(6), z.literal(6), z.literal(6)]),
        upsampler: z.literal('pixelshuffle'),
      })
      .passthrough(),
    export: z
      .object({
        opset: z.literal(17),
        inputName: z.literal('input'),
        outputName: z.literal('output'),
        simplified: z.literal(false),
        onnxSha256: z.null(),
      })
      .passthrough(),
  })
  .passthrough();

const manifest = manifestSchema.parse(await Bun.file('tools/models/swinir/export_manifest.json').json());
if (manifest.checkpoint.redistributionApproved || manifest.export.onnxSha256 !== null) {
  throw new Error('Unlicensed model bytes must not become distributable.');
}
console.log('single-image SR model provenance ok (capability honestly disabled)');
