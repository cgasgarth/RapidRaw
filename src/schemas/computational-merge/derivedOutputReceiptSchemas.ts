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

export const derivedOutputProvenanceSourceSchema = z
  .object({
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    order: z.number().int().nonnegative(),
    path: z.string().trim().min(1).optional(),
  })
  .strict();

export const derivedOutputProvenanceSidecarSchema = z
  .object({
    acceptedApplyId: z.string().trim().min(1).optional(),
    acceptedDryRunId: z.string().trim().min(1).optional(),
    app: z
      .object({
        buildVersion: z.string().trim().min(1),
        id: z.literal('io.github.CyberTimon.RapidRAW'),
        name: z.literal('RapidRAW'),
      })
      .strict(),
    output: z
      .object({
        contentHash: z.string().trim().min(1),
        path: z.string().trim().min(1),
      })
      .strict(),
    receipt: z
      .object({
        family: derivedOutputFamilySchema,
        receiptId: z.string().trim().min(1),
      })
      .strict(),
    schemaVersion: z.literal(1),
    settingsHash: z.string().trim().min(1),
    sidecarPath: z.string().trim().min(1),
    sourceState: z.array(derivedOutputProvenanceSourceSchema).min(1),
    superResolution: z
      .object({
        registrationMetrics: z
          .object({
            algorithmId: z.literal('output_lattice_phase_residual_v1'),
            averageConfidence: z.number().min(0).max(1),
            averageResidualPx: z.number().min(0),
            maxResidualPx: z.number().min(0),
            measuredSubpixelFrameCount: z.number().int().nonnegative(),
          })
          .strict(),
        supportMap: z
          .object({
            artifactId: z.string().trim().min(1),
            coverageRatio: z.number().min(0).max(1),
            effectiveScale: z.number().min(1).max(4),
            requestedScale: z.number().min(1.1).max(4),
            reviewStatus: z.enum(['apply_ready', 'blocked', 'review_required']),
            weakSupportRatio: z.number().min(0).max(1),
          })
          .strict(),
      })
      .strict()
      .optional(),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((sidecar, context) => {
    const sourceOrders = new Set<number>();
    for (const [index, source] of sidecar.sourceState.entries()) {
      if (source.order !== index) {
        context.addIssue({
          code: 'custom',
          message: 'Derived output provenance source order must match array order.',
          path: ['sourceState', index, 'order'],
        });
      }
      if (sourceOrders.has(source.order)) {
        context.addIssue({
          code: 'custom',
          message: 'Derived output provenance source order must be unique.',
          path: ['sourceState', index, 'order'],
        });
      }
      sourceOrders.add(source.order);
    }
  });

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
    provenanceSidecar: derivedOutputProvenanceSidecarSchema.optional(),
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
    if (receipt.provenanceSidecar !== undefined) {
      if (receipt.outputPath === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Derived output provenance sidecars require an output path.',
          path: ['provenanceSidecar'],
        });
      }
      if (receipt.provenanceSidecar.receipt.receiptId !== receipt.receiptId) {
        context.addIssue({
          code: 'custom',
          message: 'Derived output provenance sidecar receipt id must match receipt.',
          path: ['provenanceSidecar', 'receipt', 'receiptId'],
        });
      }
      if (receipt.provenanceSidecar.receipt.family !== receipt.family) {
        context.addIssue({
          code: 'custom',
          message: 'Derived output provenance sidecar family must match receipt.',
          path: ['provenanceSidecar', 'receipt', 'family'],
        });
      }
      if (receipt.provenanceSidecar.output.contentHash !== receipt.outputContentHash) {
        context.addIssue({
          code: 'custom',
          message: 'Derived output provenance sidecar output hash must match receipt.',
          path: ['provenanceSidecar', 'output', 'contentHash'],
        });
      }
      if (receipt.provenanceSidecar.output.path !== receipt.outputPath) {
        context.addIssue({
          code: 'custom',
          message: 'Derived output provenance sidecar output path must match receipt.',
          path: ['provenanceSidecar', 'output', 'path'],
        });
      }
      if (receipt.provenanceSidecar.settingsHash !== receipt.settingsHash) {
        context.addIssue({
          code: 'custom',
          message: 'Derived output provenance sidecar settings hash must match receipt.',
          path: ['provenanceSidecar', 'settingsHash'],
        });
      }
      if (receipt.provenanceSidecar.sourceState.length !== receipt.sourceCount) {
        context.addIssue({
          code: 'custom',
          message: 'Derived output provenance sidecar source count must match receipt.',
          path: ['provenanceSidecar', 'sourceState'],
        });
      }
    }
  });

export type DerivedOutputReceipt = z.infer<typeof derivedOutputReceiptSchema>;
export type DerivedOutputStaleReason = z.infer<typeof derivedOutputStaleReasonSchema>;
export type DerivedOutputProvenanceSidecar = z.infer<typeof derivedOutputProvenanceSidecarSchema>;
