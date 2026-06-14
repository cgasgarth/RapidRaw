import { z } from 'zod';

const nullableStringSchema = z.string().trim().min(1).nullable();
const nullablePositiveIntSchema = z.number().int().positive().nullable();

export const publicFixtureManifestEntrySchema = z
  .object({
    bitDepth: nullablePositiveIntSchema,
    cameraOrScanner: nullableStringSchema,
    captureMethod: z.string().trim().min(1),
    class: z.enum(['synthetic', 'public-small']),
    colorProfile: z.string().trim().min(1),
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    expectedSizeBytes: nullablePositiveIntSchema,
    expectedWarnings: z.array(z.string().trim().min(1)),
    fixtureId: z.string().trim().min(1),
    generator: nullableStringSchema,
    height: nullablePositiveIntSchema,
    localOnly: z.boolean(),
    mediaType: z.string().trim().min(1),
    notes: z.string().trim().min(1),
    privateCiOnly: z.boolean(),
    publicCiAllowed: z.boolean(),
    redistributionAllowed: z.boolean(),
    reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    reviewer: z.string().trim().min(1),
    sourceLicense: z.string().trim().min(1),
    sourceUrl: z.url().nullable(),
    status: z.enum(['planned', 'active', 'retired']),
    validationPurpose: z.string().trim().min(1),
    width: nullablePositiveIntSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.publicCiAllowed && (!entry.redistributionAllowed || entry.privateCiOnly || entry.localOnly)) {
      context.addIssue({
        code: 'custom',
        message: 'Public CI fixtures must be redistributable and not private/local only.',
        path: ['publicCiAllowed'],
      });
    }

    if (entry.privateCiOnly && entry.publicCiAllowed) {
      context.addIssue({
        code: 'custom',
        message: 'Private-only fixtures cannot be allowed in public CI.',
        path: ['privateCiOnly'],
      });
    }

    if (entry.class === 'synthetic' && entry.generator === null) {
      context.addIssue({
        code: 'custom',
        message: 'Synthetic fixtures must declare a generator.',
        path: ['generator'],
      });
    }

    if (entry.status === 'active' && (entry.expectedSha256 === null || entry.expectedSizeBytes === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Active fixtures must declare expected hash and size.',
        path: ['status'],
      });
    }
  });

export const publicFixtureManifestSchema = z
  .object({
    $schema: z.url(),
    entries: z.array(publicFixtureManifestEntrySchema).min(1),
    issue: z.number().int().positive(),
    policy: z.string().trim().min(1),
    schemaVersion: z.literal(0),
    snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seenFixtureIds = new Set<string>();

    manifest.entries.forEach((entry, index) => {
      if (seenFixtureIds.has(entry.fixtureId)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate fixture ID: ${entry.fixtureId}.`,
          path: ['entries', index, 'fixtureId'],
        });
      }
      seenFixtureIds.add(entry.fixtureId);
    });
  });

export type PublicFixtureManifest = z.infer<typeof publicFixtureManifestSchema>;
export type PublicFixtureManifestEntry = z.infer<typeof publicFixtureManifestEntrySchema>;

export const parsePublicFixtureManifest = (value: unknown): PublicFixtureManifest =>
  publicFixtureManifestSchema.parse(value);
