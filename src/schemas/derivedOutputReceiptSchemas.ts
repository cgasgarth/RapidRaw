import { z } from 'zod';

export const derivedOutputFamilySchema = z.enum(['focus_stack', 'hdr', 'panorama', 'super_resolution']);
export const derivedOutputStoragePolicySchema = z.enum(['export_path', 'sidecar_artifact', 'temp_cache']);
export const derivedOutputOpenActionStateSchema = z.enum(['available', 'deferred', 'unavailable']);

export const derivedOutputReceiptSchema = z
  .object({
    family: derivedOutputFamilySchema,
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
    receiptId: z.string().trim().min(1),
    settingsHash: z.string().trim().min(1),
    sourceContentHashes: z.array(z.string().trim().min(1)).min(1),
    sourceCount: z.number().int().positive(),
    sourceGraphRevisions: z.array(z.string().trim().min(1)).min(1),
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
  });

export type DerivedOutputReceipt = z.infer<typeof derivedOutputReceiptSchema>;
