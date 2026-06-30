import { z } from 'zod';

import { rawOpenEditExportBasicToneCommandSchema } from '../rawOpenEditExportCommandSchemas';

const pixelSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);

export const headlessRenderRequestSchema = z
  .object({
    command: rawOpenEditExportBasicToneCommandSchema,
    outputArtifactPath: z.string().trim().min(1),
    renderer: z.literal('synthetic_basic_tone_v1'),
    schemaVersion: z.literal(1),
    sourcePixels: z.array(pixelSchema).min(1),
  })
  .strict();

export const headlessRenderArtifactSchema = z
  .object({
    afterHash: z.string().regex(/^[a-f0-9]{64}$/u),
    beforeHash: z.string().regex(/^[a-f0-9]{64}$/u),
    changedPixels: z.number().int().positive(),
    commandId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    outputPixels: z.array(pixelSchema).min(1),
    renderer: z.literal('synthetic_basic_tone_v1'),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.beforeHash === artifact.afterHash) {
      context.addIssue({ code: 'custom', message: 'Headless render output must change the source hash.' });
    }
  });

export type HeadlessRenderRequest = z.infer<typeof headlessRenderRequestSchema>;
export type HeadlessRenderArtifact = z.infer<typeof headlessRenderArtifactSchema>;
export type HeadlessRenderPixel = z.infer<typeof pixelSchema>;
