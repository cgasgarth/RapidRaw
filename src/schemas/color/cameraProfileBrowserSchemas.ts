import { z } from 'zod';
import { cameraProfileIdSchema } from './profileToneSchemas';

export const cameraProfileSourceSchema = z.enum(['embedded', 'open', 'user', 'generated', 'matrix_fallback']);
export const cameraProfileBrowserEntrySchema = z
  .object({
    cameraModel: z.string().min(1).nullable(),
    compatible: z.boolean(),
    creativeAmountSupported: z.boolean(),
    contentSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    displayName: z.string().min(1),
    favorite: z.boolean(),
    id: cameraProfileIdSchema,
    lastUsedEpochMs: z.number().int().nonnegative().nullable(),
    source: cameraProfileSourceSchema,
  })
  .strict();
export const cameraProfileBrowserCatalogSchema = z.array(cameraProfileBrowserEntrySchema);
export const cameraProfileRegistryReportSchema = z
  .object({
    entries: cameraProfileBrowserCatalogSchema,
    quarantine: z.array(z.object({ privatePathToken: z.string().min(1), reasonCode: z.string().min(1) }).strict()),
  })
  .strict();

export type CameraProfileBrowserEntry = z.infer<typeof cameraProfileBrowserEntrySchema>;
