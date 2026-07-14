import { z } from 'zod';

import {
  negativeLabMeasuredProfileSchema,
  negativeLabMeasurementReportSchema,
} from './negativeLabMeasuredProfileSchemas';

export const negativeLabMeasuredProfileLibraryHashSchema = z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u);

export const negativeLabMeasuredProfileLibraryEntrySchema = z
  .object({
    contentHash: negativeLabMeasuredProfileLibraryHashSchema,
    createdAt: z.string().datetime({ offset: true }),
    profile: negativeLabMeasuredProfileSchema,
    report: negativeLabMeasurementReportSchema,
    source: z.literal('imported_local'),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.report.profileId !== entry.profile.profileId) {
      context.addIssue({
        code: 'custom',
        message: 'Measured profile and report ids must match.',
        path: ['report', 'profileId'],
      });
    }
    if (JSON.stringify(entry.report.fittedParams) !== JSON.stringify(entry.profile.params)) {
      context.addIssue({
        code: 'custom',
        message: 'Measured profile params must match report fitted params.',
        path: ['report', 'fittedParams'],
      });
    }
  });

export const negativeLabMeasuredProfileLibrarySchema = z
  .object({
    entries: z.array(negativeLabMeasuredProfileLibraryEntrySchema),
    libraryId: z.literal('negative_lab_measured_profile_library'),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((library, context) => {
    const ids = new Set<string>();
    const hashes = new Set<string>();
    for (const [index, entry] of library.entries.entries()) {
      if (ids.has(entry.profile.profileId)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate local measured profile id.',
          path: ['entries', index, 'profile', 'profileId'],
        });
      }
      if (hashes.has(entry.contentHash)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate local measured profile content hash.',
          path: ['entries', index, 'contentHash'],
        });
      }
      ids.add(entry.profile.profileId);
      hashes.add(entry.contentHash);
    }
  });

export type NegativeLabMeasuredProfileLibraryEntry = z.infer<typeof negativeLabMeasuredProfileLibraryEntrySchema>;
export type NegativeLabMeasuredProfileLibrary = z.infer<typeof negativeLabMeasuredProfileLibrarySchema>;

export const parseNegativeLabMeasuredProfileLibrary = (value: unknown): NegativeLabMeasuredProfileLibrary =>
  negativeLabMeasuredProfileLibrarySchema.parse(value);
