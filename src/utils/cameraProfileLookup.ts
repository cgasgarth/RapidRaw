import { z } from 'zod';

export const cameraProfileClassSchema = z.enum([
  'generic_camera_profile',
  'licensed_camera_profile',
  'measured_camera_profile',
]);
export const cameraProfileInputTransformSchema = z.enum([
  'dng_color_matrix',
  'embedded_dng_color_matrix',
  'libraw_camera_matrix',
  'raw_decoder_neutral_matrix',
]);
export const cameraProfileWarningSchema = z.enum([
  'camera_profile_embedded_fallback',
  'camera_profile_generic_fallback',
]);

export const cameraProfileEntrySchema = z
  .object({
    id: z.string().min(1),
    inputTransform: cameraProfileInputTransformSchema,
    manufacturer: z.string().min(1),
    models: z.array(z.string().min(1)).min(1),
    priority: z.number().int().nonnegative(),
    profileClass: cameraProfileClassSchema,
    rawExtensions: z.array(z.string().min(1)).min(1),
    source: z.string().min(1),
  })
  .strict();

export const cameraProfileFallbackSchema = z
  .object({
    id: z.string().min(1),
    inputTransform: cameraProfileInputTransformSchema,
    rawExtensions: z.array(z.string().min(1)).min(1),
    warning: cameraProfileWarningSchema,
  })
  .strict();

export const cameraProfileMetadataSchema = z
  .object({
    manufacturer: z.string().min(1),
    model: z.string().min(1),
    rawExtension: z.string().min(1),
  })
  .strict();

export const cameraProfileLookupCatalogSchema = z
  .object({
    fallbacks: z.array(cameraProfileFallbackSchema).min(1),
    profiles: z.array(cameraProfileEntrySchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    for (const [index, entry] of [...catalog.profiles, ...catalog.fallbacks].entries()) {
      if (ids.has(entry.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate profile/fallback id: ${entry.id}`,
          path: [index < catalog.profiles.length ? 'profiles' : 'fallbacks'],
        });
      }
      ids.add(entry.id);
    }
  });

export type CameraProfileLookupCatalog = z.infer<typeof cameraProfileLookupCatalogSchema>;
export type CameraProfileMetadata = z.infer<typeof cameraProfileMetadataSchema>;
export type CameraProfileWarning = z.infer<typeof cameraProfileWarningSchema>;

export interface CameraProfileLookupResult {
  id: string;
  inputTransform: z.infer<typeof cameraProfileInputTransformSchema>;
  warning: CameraProfileWarning | null;
}

const normalize = (value: string) => value.trim().toLowerCase();
const normalizeExtension = (value: string) => normalize(value).replace(/^\./u, '');

export function lookupCameraProfile(value: unknown, metadataValue: unknown): CameraProfileLookupResult {
  const catalog = cameraProfileLookupCatalogSchema.parse(value);
  const metadata = cameraProfileMetadataSchema.parse(metadataValue);
  const manufacturer = normalize(metadata.manufacturer);
  const model = normalize(metadata.model);
  const extension = normalizeExtension(metadata.rawExtension);

  const matchedProfiles = catalog.profiles
    .filter((profile) => profile.rawExtensions.map(normalizeExtension).includes(extension))
    .filter((profile) => normalize(profile.manufacturer) === manufacturer)
    .filter((profile) => profile.models.map(normalize).includes(model))
    .sort((left, right) => right.priority - left.priority);

  if (matchedProfiles[0]) {
    return {
      id: matchedProfiles[0].id,
      inputTransform: matchedProfiles[0].inputTransform,
      warning: null,
    };
  }

  const fallback = catalog.fallbacks.find((candidate) =>
    candidate.rawExtensions.map(normalizeExtension).includes(extension),
  );
  if (!fallback) throw new Error(`No fallback covers extension: ${extension}`);

  return {
    id: fallback.id,
    inputTransform: fallback.inputTransform,
    warning: fallback.warning,
  };
}
