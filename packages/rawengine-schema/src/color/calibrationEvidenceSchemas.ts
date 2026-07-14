import { z } from 'zod';

export const calibrationEvidenceRefV1Schema = z
  .object({
    evidenceId: z.string().min(1),
    evidenceVersion: z.string().min(1),
    sourceKind: z.enum(['project_measurement', 'project_engineered', 'licensed_dataset']),
    manifestPathOrUri: z.string().min(1),
    manifestSha256: z.string().regex(/^sha256:[0-9a-z-]+$/u),
    licenseSpdx: z.array(z.string().min(1)).min(1),
    noticePaths: z.array(z.string().min(1)),
    methodVersion: z.string().min(1),
    limitations: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type CalibrationEvidenceRefV1 = z.infer<typeof calibrationEvidenceRefV1Schema>;
