import { z } from 'zod';

export const hdrExportTargetV1Schema = z.enum(['sdr_companion_tiff16', 'hdr_pq10', 'hdr_hlg10']);

export const sdrRenditionSettingsV1Schema = z
  .object({
    contrast: z.number().min(0.5).max(1.5),
    highlightCompression: z.number().min(0).max(1),
    saturation: z.number().min(0).max(1.5),
    shadowLift: z.number().min(0).max(1),
    targetWhiteNits: z.number().min(80).max(300),
  })
  .strict();

export const hdrExportWorkflowSettingsV1Schema = z
  .object({
    sdrRendition: sdrRenditionSettingsV1Schema,
    target: hdrExportTargetV1Schema,
  })
  .strict();

export const hdrExportPreflightV1Schema = z
  .object({
    bitDepth: z.number().int().positive().nullable(),
    blockCode: z.string().nullable(),
    colorPrimaries: z.string().nullable(),
    rendition: z.string(),
    supported: z.boolean(),
    target: hdrExportTargetV1Schema,
    transfer: z.string().nullable(),
  })
  .strict();

export const hdrExportCapabilityCatalogV1Schema = z
  .object({
    implementationVersion: z.number().int().positive(),
    targets: z.array(hdrExportPreflightV1Schema).length(3),
  })
  .strict();

export const hdrExportReceiptV1Schema = z
  .object({
    bitDepth: z.number().int().positive(),
    byteSize: z.number().int().nonnegative(),
    colorPolicyFingerprint: z.string().min(1),
    colorPrimaries: z.string().min(1),
    fileFormat: z.string().min(1),
    implementationVersion: z.number().int().positive(),
    planFingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    rendition: z.string().min(1),
    sceneEditFingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    target: hdrExportTargetV1Schema,
    transfer: z.string().min(1),
    viewFingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .strict();

export type HdrExportCapabilityCatalogV1 = z.infer<typeof hdrExportCapabilityCatalogV1Schema>;
export type HdrExportReceiptV1 = z.infer<typeof hdrExportReceiptV1Schema>;
export type HdrExportWorkflowSettingsV1 = z.infer<typeof hdrExportWorkflowSettingsV1Schema>;
