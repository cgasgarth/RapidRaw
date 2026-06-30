import { z } from 'zod';

export const proofLevelSchema = z.enum(['runtime_quality_harness', 'synthetic_shared_preview_export_match']);

export const proofEntrypointsSchema = z
  .object({
    export: z.string().trim().min(1).optional(),
    preview: z.string().trim().min(1).optional(),
    report: z.string().trim().min(1).optional(),
    runtime: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((entrypoints, context) => {
    if (
      entrypoints.export === undefined &&
      entrypoints.preview === undefined &&
      entrypoints.report === undefined &&
      entrypoints.runtime === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Proof contracts require at least one explicit proof entrypoint.',
      });
    }
  });

export const proofContractSchema = z
  .looseObject({
    doesNotProve: z.array(z.string().trim().min(1)).min(1),
    proofEntrypoints: proofEntrypointsSchema,
    proofLevel: proofLevelSchema,
    runtimeStatus: z.string().trim().min(1),
  })
  .superRefine((contract, context) => {
    const sharedPreviewExportEntrypoint =
      contract.proofEntrypoints.preview !== undefined &&
      contract.proofEntrypoints.preview === contract.proofEntrypoints.export;

    if (!sharedPreviewExportEntrypoint) return;

    if (contract.runtimeStatus.includes('independent')) {
      context.addIssue({
        code: 'custom',
        message: 'Shared preview/export entrypoints cannot claim independent parity.',
        path: ['runtimeStatus'],
      });
    }

    if (contract.proofLevel !== 'synthetic_shared_preview_export_match') {
      context.addIssue({
        code: 'custom',
        message: 'Shared preview/export entrypoints must use synthetic_shared_preview_export_match proof level.',
        path: ['proofLevel'],
      });
    }

    if (!contract.doesNotProve.includes('independent_preview_export_paths')) {
      context.addIssue({
        code: 'custom',
        message: 'Shared preview/export entrypoints must list independent_preview_export_paths as unproven.',
        path: ['doesNotProve'],
      });
    }
  });

export type ProofContract = z.infer<typeof proofContractSchema>;

export function collectProofContractFailures(path: string, value: unknown): string[] {
  const parsed = proofContractSchema.safeParse(value);
  if (parsed.success) return [];

  return parsed.error.issues.map((issue) => {
    const issuePath = issue.path.length > 0 ? ` ${issue.path.join('.')}` : '';
    return `${path}:${issuePath} ${issue.message}`;
  });
}
