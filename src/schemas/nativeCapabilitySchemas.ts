import { z } from 'zod';

export const nativeCapabilityManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    buildProfile: z.enum(['fast_dev', 'full']),
    ai: z.boolean(),
    advancedCodecs: z.boolean(),
    computational: z.boolean(),
  })
  .strict();

export type NativeCapabilityManifest = z.infer<typeof nativeCapabilityManifestSchema>;

export const capabilityUnavailableSchema = z
  .object({
    code: z.literal('capability_unavailable'),
    capability: z.enum(['ai', 'computational', 'advancedCodecs']),
  })
  .strict();
