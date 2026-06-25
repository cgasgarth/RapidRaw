import { z } from 'zod';

import { exportRecipeColorProfileV1Schema, exportRecipeRenderingIntentV1Schema } from './exportRecipeSchemas.js';

export const exportColorEngineIdV1Schema = z.enum(['moxcms']);
export const exportBlackPointCompensationStatusV1Schema = z.enum(['unsupported', 'supported']);

export const exportColorCapabilityV1Schema = z
  .object({
    blackPointCompensation: exportBlackPointCompensationStatusV1Schema,
    colorProfile: exportRecipeColorProfileV1Schema,
    engine: exportColorEngineIdV1Schema,
    renderingIntents: z.array(exportRecipeRenderingIntentV1Schema).min(1),
    runtimeSupportNotes: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((capability, context) => {
    if (
      capability.blackPointCompensation === 'supported' &&
      !capability.renderingIntents.includes('relativeColorimetric')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Black-point compensation support requires relative colorimetric intent support.',
        path: ['blackPointCompensation'],
      });
    }
  });

export const exportColorCapabilityCatalogV1Schema = z
  .object({
    capabilities: z.array(exportColorCapabilityV1Schema).min(1),
    engine: exportColorEngineIdV1Schema,
    schemaVersion: z.literal(1),
  })
  .strict();

export type ExportColorCapabilityV1 = z.infer<typeof exportColorCapabilityV1Schema>;
export type ExportColorCapabilityCatalogV1 = z.infer<typeof exportColorCapabilityCatalogV1Schema>;

const MOXCMS_RENDERING_INTENTS: ExportColorCapabilityV1['renderingIntents'] = [
  'relativeColorimetric',
  'perceptual',
  'saturation',
  'absoluteColorimetric',
];

const MOXCMS_SUPPORTED_PROFILES: Array<ExportColorCapabilityV1['colorProfile']> = [
  'srgb',
  'displayP3',
  'adobeRgb1998',
  'proPhotoRgb',
];

export const MOXCMS_EXPORT_COLOR_CAPABILITIES_V1 = exportColorCapabilityCatalogV1Schema.parse({
  capabilities: MOXCMS_SUPPORTED_PROFILES.map((colorProfile) => ({
    blackPointCompensation: 'unsupported',
    colorProfile,
    engine: 'moxcms',
    renderingIntents: MOXCMS_RENDERING_INTENTS,
    runtimeSupportNotes: [
      'Rendering intent is passed to moxcms transform options.',
      'Black-point compensation remains disabled until the CMM exposes an applied BPC option.',
    ],
  })),
  engine: 'moxcms',
  schemaVersion: 1,
});

export const getMoxcmsExportColorCapability = (
  colorProfile: ExportColorCapabilityV1['colorProfile'],
): ExportColorCapabilityV1 | null =>
  MOXCMS_EXPORT_COLOR_CAPABILITIES_V1.capabilities.find((capability) => capability.colorProfile === colorProfile) ??
  null;
