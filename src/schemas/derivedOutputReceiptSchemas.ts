import { z } from 'zod';

export const derivedOutputFamilySchema = z.enum(['focus_stack', 'hdr', 'panorama', 'super_resolution']);
export const derivedOutputStoragePolicySchema = z.enum(['export_path', 'sidecar_artifact', 'temp_cache']);
export const derivedOutputOpenActionStateSchema = z.enum(['available', 'deferred', 'unavailable']);
export const derivedOutputStaleReasonSchema = z.enum([
  'accepted_dry_run_plan_changed',
  'output_artifact_changed',
  'recipe_hash_changed',
  'settings_hash_changed',
  'source_content_hash_changed',
  'source_graph_revision_changed',
  'source_order_changed',
  'source_set_changed',
]);

export const derivedOutputReceiptSchema = z
  .object({
    family: derivedOutputFamilySchema,
    acceptedDryRunPlanHash: z.string().trim().min(1).optional(),
    acceptedDryRunPlanId: z.string().trim().min(1).optional(),
    openInEditorAction: z
      .object({
        label: z.string().trim().min(1),
        path: z.string().trim().min(1).optional(),
        state: derivedOutputOpenActionStateSchema,
      })
      .strict(),
    outputArtifactId: z.string().trim().min(1),
    outputContentHash: z.string().trim().min(1),
    outputPath: z.string().trim().min(1).optional(),
    recipeHash: z.string().trim().min(1).optional(),
    receiptId: z.string().trim().min(1),
    settingsHash: z.string().trim().min(1),
    sourceContentHashes: z.array(z.string().trim().min(1)).min(1),
    sourceCount: z.number().int().positive(),
    sourceGraphRevisions: z.array(z.string().trim().min(1)).min(1),
    staleReasons: z.array(derivedOutputStaleReasonSchema).optional(),
    staleState: z.enum(['current', 'stale', 'unknown']),
    storagePolicy: derivedOutputStoragePolicySchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.sourceContentHashes.length !== receipt.sourceCount) {
      context.addIssue({
        code: 'custom',
        message: 'Derived output sourceContentHashes length must match sourceCount.',
        path: ['sourceContentHashes'],
      });
    }
    if (receipt.sourceGraphRevisions.length !== receipt.sourceCount) {
      context.addIssue({
        code: 'custom',
        message: 'Derived output sourceGraphRevisions length must match sourceCount.',
        path: ['sourceGraphRevisions'],
      });
    }
    if (receipt.openInEditorAction.state === 'available' && receipt.openInEditorAction.path === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Available derived output open actions require a path.',
        path: ['openInEditorAction', 'path'],
      });
    }
    if (receipt.staleState === 'stale' && (receipt.staleReasons?.length ?? 0) === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Stale derived output receipts require at least one stale reason.',
        path: ['staleReasons'],
      });
    }
    if (receipt.staleState !== 'stale' && receipt.staleReasons !== undefined && receipt.staleReasons.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Current derived output receipts must not carry stale reasons.',
        path: ['staleReasons'],
      });
    }
  });

export type DerivedOutputReceipt = z.infer<typeof derivedOutputReceiptSchema>;
export type DerivedOutputStaleReason = z.infer<typeof derivedOutputStaleReasonSchema>;
