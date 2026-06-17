import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const privatePathSchema = z
  .string()
  .trim()
  .regex(/^(private-fixtures|private-artifacts)\//u);

const hashedPathSchema = z
  .object({
    hash: sha256Schema,
    path: privatePathSchema,
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const artifactKindSchema = z.enum([
  'source_raw_private',
  'preview_before_private',
  'preview_after_private',
  'export_after_private',
  'sidecar_after_private',
  'workflow_report_private',
]);

const metricNameSchema = z.enum([
  'changedPixelRatio',
  'previewExportMeanAbsDelta',
  'sidecarReloadRevisionMatch',
  'sourceHashUnchanged',
]);

const runArtifactSchema = hashedPathSchema.extend({
  kind: artifactKindSchema,
});

const qualityMetricSchema = z
  .object({
    name: metricNameSchema,
    passed: z.literal(true),
    source: z.literal('private_raw_report'),
    threshold: z.number().min(0),
    value: z.number().min(0),
  })
  .strict();

const privateRunReportSchema = z
  .object({
    artifacts: z.array(runArtifactSchema).min(6),
    editCommandId: z.string().trim().min(1),
    editGraphRevision: z.string().regex(/^graph-rev\.[a-z0-9.-]+\.v[0-9]+$/u),
    fixtureId: z.string().regex(/^validation\.raw-open-edit-export\.[a-z0-9.-]+\.v[0-9]+$/u),
    generatedAt: z.iso.datetime(),
    metrics: z.array(qualityMetricSchema).min(4),
    previewAfter: hashedPathSchema,
    previewBefore: hashedPathSchema,
    reportId: z.string().regex(/^raw-open-edit-export-run\.[a-z0-9.-]+\.v[0-9]+$/u),
    sidecarAfter: hashedPathSchema,
    sourceRaw: hashedPathSchema,
    trackingIssue: z.literal(1376),
  })
  .strict()
  .superRefine((report, context) => {
    const artifactKinds = report.artifacts.map((artifact) => artifact.kind);
    if (new Set(artifactKinds).size !== artifactKinds.length) {
      context.addIssue({
        code: 'custom',
        message: 'RAW open/edit/export run artifact kinds must be unique.',
        path: ['artifacts'],
      });
    }

    const metricNames = report.metrics.map((metric) => metric.name);
    if (new Set(metricNames).size !== metricNames.length) {
      context.addIssue({
        code: 'custom',
        message: 'RAW open/edit/export run metrics must be unique.',
        path: ['metrics'],
      });
    }

    for (const requiredMetric of metricNameSchema.options) {
      if (!metricNames.includes(requiredMetric)) {
        context.addIssue({
          code: 'custom',
          message: `RAW open/edit/export run report requires ${requiredMetric}.`,
          path: ['metrics'],
        });
      }
    }
  });

export const rawOpenEditExportRunReportCollectionSchema = z
  .object({
    $schema: z.url(),
    issue: z.literal(1829),
    reports: z.array(privateRunReportSchema),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    validationMode: z.literal('public_schema_private_reports'),
  })
  .strict()
  .superRefine((collection, context) => {
    const reportIds = collection.reports.map((report) => report.reportId);
    if (new Set(reportIds).size !== reportIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'RAW open/edit/export run report IDs must be unique.',
        path: ['reports'],
      });
    }

    const fixtureIds = collection.reports.map((report) => report.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Only one RAW open/edit/export run report is allowed per fixture.',
        path: ['reports'],
      });
    }
  });

export type RawOpenEditExportRunReportCollection = z.infer<typeof rawOpenEditExportRunReportCollectionSchema>;

export function parseRawOpenEditExportRunReportCollection(value: unknown): RawOpenEditExportRunReportCollection {
  return rawOpenEditExportRunReportCollectionSchema.parse(value);
}
