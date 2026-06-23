import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const workflowStepSchema = z.enum([
  'open_raw',
  'apply_edit_graph',
  'render_preview',
  'export_image',
  'write_sidecar',
  'reload_sidecar',
]);

const proofArtifactSchema = z
  .object({
    hash: sha256Schema.nullable(),
    kind: z.enum([
      'source_raw_private',
      'preview_before_private',
      'preview_after_private',
      'export_after_private',
      'soft_proof_after_private',
      'sidecar_after_private',
      'workflow_report_private',
    ]),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const proofMetricSchema = z
  .object({
    name: z.enum([
      'previewExportMeanAbsDelta',
      'softProofExportRgb8MeanAbsDelta',
      'sidecarReloadRevisionMatch',
      'sourceHashUnchanged',
    ]),
    required: z.literal(true),
    threshold: z.number().min(0),
  })
  .strict();

const proofCaseSchema = z
  .object({
    artifacts: z.array(proofArtifactSchema).min(5),
    editGraphRevision: z.string().regex(/^graph-rev\.[a-z0-9.-]+\.v[0-9]+$/u),
    evidenceId: z.string().regex(/^raw-evidence\.[a-z0-9.-]+\.v[0-9]+$/u),
    expectedMetrics: z.array(proofMetricSchema).min(3),
    fixtureId: z.string().regex(/^validation\.raw-open-edit-export\.[a-z0-9.-]+\.v[0-9]+$/u),
    localRelativePath: z.string().trim().min(1),
    notes: z.string().trim().min(1),
    status: z.enum(['pending_private_asset', 'accepted_private_asset']),
    trackingIssue: z.literal(1376),
    workflowSteps: z.array(workflowStepSchema).min(6),
  })
  .strict()
  .superRefine((proofCase, context) => {
    const steps = new Set(proofCase.workflowSteps);
    for (const requiredStep of workflowStepSchema.options) {
      if (!steps.has(requiredStep)) {
        context.addIssue({
          code: 'custom',
          message: `RAW open/edit/export proof requires ${requiredStep}.`,
          path: ['workflowSteps'],
        });
      }
    }

    const artifactKinds = new Set(proofCase.artifacts.map((artifact) => artifact.kind));
    for (const requiredKind of [
      'source_raw_private',
      'preview_before_private',
      'preview_after_private',
      'export_after_private',
      'sidecar_after_private',
    ] as const) {
      if (!artifactKinds.has(requiredKind)) {
        context.addIssue({
          code: 'custom',
          message: `RAW open/edit/export proof requires ${requiredKind}.`,
          path: ['artifacts'],
        });
      }
    }

    if (proofCase.status === 'accepted_private_asset') {
      for (const [artifactIndex, artifact] of proofCase.artifacts.entries()) {
        if (artifact.hash === null) {
          context.addIssue({
            code: 'custom',
            message: 'Accepted private RAW proof artifacts require non-null hashes.',
            path: ['artifacts', artifactIndex, 'hash'],
          });
        }
      }
    }
  });

export const rawOpenEditExportProofManifestSchema = z
  .object({
    $schema: z.url(),
    issue: z.literal(1376),
    proofCases: z.array(proofCaseSchema).min(1),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    validationMode: z.literal('schema_public_assets_private'),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.proofCases.map((proofCase) => proofCase.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'RAW open/edit/export proof fixture IDs must be unique.',
        path: ['proofCases'],
      });
    }
  });

export type RawOpenEditExportProofManifest = z.infer<typeof rawOpenEditExportProofManifestSchema>;

export function parseRawOpenEditExportProofManifest(value: unknown): RawOpenEditExportProofManifest {
  return rawOpenEditExportProofManifestSchema.parse(value);
}
