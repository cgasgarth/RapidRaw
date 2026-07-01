import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const featureFamilySchema = z.enum(['hdr_merge', 'panorama_stitch', 'focus_stack', 'super_resolution']);

const workflowStepSchema = z.enum([
  'open_raw_sequence',
  'decode_raw_sources',
  'align_sources',
  'merge_sources',
  'render_preview',
  'export_artifact',
  'record_quality_metrics',
]);

const artifactKindSchema = z.enum([
  'source_raw_sequence_private',
  'alignment_report_private',
  'merge_output_private',
  'preview_after_private',
  'export_after_private',
  'quality_report_private',
  'app_server_runtime_report_private',
]);

const proofMetricNameSchema = z.enum([
  'alignmentInlierRatio',
  'edgeContinuityScore',
  'exposureBracketCoverageEv',
  'focusTransitionArtifactScore',
  'ghostSuppressionScore',
  'highlightRecoveryRatio',
  'sharpnessGainRatio',
  'superResolutionDetailGainRatio',
  'superResolutionRegistrationResidualPx',
  'previewExportMeanAbsDelta',
]);

const featureIssues = {
  focus_stack: {
    implementationIssue: 1507,
    uiIssue: 1334,
  },
  hdr_merge: {
    implementationIssue: 2062,
    uiIssue: 171,
  },
  panorama_stitch: {
    implementationIssue: 4493,
    uiIssue: 1333,
  },
  super_resolution: {
    implementationIssue: 1506,
    uiIssue: 1335,
  },
} as const;

const artifactSchema = z
  .object({
    hash: sha256Schema.nullable(),
    kind: artifactKindSchema,
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const proofMetricSchema = z
  .object({
    name: proofMetricNameSchema,
    required: z.literal(true),
    threshold: z.number().min(0),
  })
  .strict();

const nonClaimSchema = z.enum([
  'not_runtime_e2e_verified',
  'not_ui_verified',
  'not_quality_accepted',
  'private_assets_not_public',
]);

const proofCaseSchema = z
  .object({
    artifacts: z.array(artifactSchema).min(6),
    evidenceId: z.string().regex(/^raw-evidence\.[a-z0-9.-]+\.v[0-9]+$/u),
    expectedMetrics: z.array(proofMetricSchema).min(2),
    featureFamily: featureFamilySchema,
    fixtureId: z.string().regex(/^validation\.computational-merge\.[a-z0-9.-]+\.v[0-9]+$/u),
    implementationIssue: z.number().int().positive(),
    localSourceRelativePaths: z.array(z.string().trim().min(1)).min(1),
    nonClaims: z.array(nonClaimSchema).min(3),
    notes: z.string().trim().min(1),
    proofStatus: z.enum([
      'manifest_only',
      'pending_private_assets',
      'runtime_apply_capable',
      'e2e_verified_private_assets',
    ]),
    uiIssue: z.number().int().positive(),
    workflowSteps: z.array(workflowStepSchema).min(7),
  })
  .strict()
  .superRefine((proofCase, context) => {
    const expectedIssues = featureIssues[proofCase.featureFamily];
    if (proofCase.implementationIssue !== expectedIssues.implementationIssue) {
      context.addIssue({
        code: 'custom',
        message: `${proofCase.featureFamily} must link implementation issue #${expectedIssues.implementationIssue}.`,
        path: ['implementationIssue'],
      });
    }
    if (proofCase.uiIssue !== expectedIssues.uiIssue) {
      context.addIssue({
        code: 'custom',
        message: `${proofCase.featureFamily} must link UI issue #${expectedIssues.uiIssue}.`,
        path: ['uiIssue'],
      });
    }

    const steps = new Set(proofCase.workflowSteps);
    for (const requiredStep of workflowStepSchema.options) {
      if (!steps.has(requiredStep)) {
        context.addIssue({
          code: 'custom',
          message: `Computational merge E2E proof requires ${requiredStep}.`,
          path: ['workflowSteps'],
        });
      }
    }

    const artifactKinds = new Set(proofCase.artifacts.map((artifact) => artifact.kind));
    const baseRequiredKinds = artifactKindSchema.options.filter(
      (artifactKind) => artifactKind !== 'app_server_runtime_report_private',
    );
    for (const requiredKind of baseRequiredKinds) {
      if (!artifactKinds.has(requiredKind)) {
        context.addIssue({
          code: 'custom',
          message: `Computational merge E2E proof requires ${requiredKind}.`,
          path: ['artifacts'],
        });
      }
    }

    if (proofCase.proofStatus === 'runtime_apply_capable' || proofCase.proofStatus === 'e2e_verified_private_assets') {
      if (!artifactKinds.has('app_server_runtime_report_private')) {
        context.addIssue({
          code: 'custom',
          message: 'Runtime-capable computational merge proof requires app_server_runtime_report_private.',
          path: ['artifacts'],
        });
      }
    }

    if (proofCase.proofStatus === 'manifest_only') {
      const nonClaims = new Set(proofCase.nonClaims);
      for (const requiredNonClaim of ['not_runtime_e2e_verified', 'not_ui_verified', 'not_quality_accepted'] as const) {
        if (!nonClaims.has(requiredNonClaim)) {
          context.addIssue({
            code: 'custom',
            message: `Manifest-only proof must declare ${requiredNonClaim}.`,
            path: ['nonClaims'],
          });
        }
      }
    }

    if (proofCase.proofStatus !== 'manifest_only') {
      proofCase.artifacts.forEach((artifact, artifactIndex) => {
        if (artifact.hash === null) {
          context.addIssue({
            code: 'custom',
            message: 'Non-manifest proof status requires non-null private artifact hashes.',
            path: ['artifacts', artifactIndex, 'hash'],
          });
        }
      });
    }
  });

export const computationalMergeE2eProofManifestSchema = z
  .object({
    $schema: z.url(),
    issue: z.literal(1809),
    proofCases: z.array(proofCaseSchema).min(3),
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
        message: 'Computational merge proof fixture IDs must be unique.',
        path: ['proofCases'],
      });
    }

    const families = new Set(manifest.proofCases.map((proofCase) => proofCase.featureFamily));
    for (const requiredFamily of featureFamilySchema.options) {
      if (!families.has(requiredFamily)) {
        context.addIssue({
          code: 'custom',
          message: `Computational merge proof manifest requires ${requiredFamily}.`,
          path: ['proofCases'],
        });
      }
    }
  });

export type ComputationalMergeE2eProofManifest = z.infer<typeof computationalMergeE2eProofManifestSchema>;

export function parseComputationalMergeE2eProofManifest(value: unknown): ComputationalMergeE2eProofManifest {
  return computationalMergeE2eProofManifestSchema.parse(value);
}
