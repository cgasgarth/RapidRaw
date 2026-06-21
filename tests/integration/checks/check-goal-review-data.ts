#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/goal-review-data-2026-06-18.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';

const statusReportSchema = z
  .object({
    generatedAt: z.iso.datetime({ offset: true }),
    proofHash: z.string().regex(/^[a-f0-9]{64}$/u),
    schemaVersion: z.number().int().positive(),
    status: z.string().trim().min(1),
  })
  .passthrough();

const artifactSchema = z
  .object({
    exists: z.boolean(),
    path: z.string().trim().min(1),
    proofKind: z.enum([
      'runtime_status',
      'render_artifact',
      'html_review',
      'screenshot',
      'svg_review',
      'markdown_policy',
    ]),
  })
  .strict();

const featureSchema = z
  .object({
    issue: z.number().int().positive(),
    name: z.string().trim().min(1),
    proofStatus: z.string().trim().min(1),
    reportPath: z.string().trim().min(1),
  })
  .strict();

const capabilityStatusSchema = z
  .object({
    area: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    issue: z.number().int().positive(),
    status: z.enum(['plan-only', 'schema-only', 'dry-run-only', 'runtime apply-capable', 'UI E2E-proven']),
  })
  .strict();

const reportSchema = z
  .object({
    artifacts: z.array(artifactSchema).min(8),
    capabilityStatuses: z.array(capabilityStatusSchema).min(5),
    commands: z.array(z.string().trim().min(1)).min(4),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1856),
    missingArtifacts: z.array(z.string().trim().min(1)).min(1),
    proofHash: z.string().regex(/^[a-f0-9]{64}$/u),
    schemaVersion: z.literal(1),
    sourceReports: z.array(featureSchema).min(3),
    status: z.enum(['review_page_data_generated']),
  })
  .strict()
  .superRefine((report, context) => {
    for (const artifact of report.artifacts) {
      if (!artifact.exists) {
        context.addIssue({
          code: 'custom',
          message: `${artifact.path} is missing.`,
          path: ['artifacts'],
        });
      }
    }
  });

const update = process.argv.includes('--update');

const sourceReports = await Promise.all(
  [
    {
      issue: 1809,
      name: 'Computational merge runtime status',
      path: 'docs/validation/computational-merge-runtime-status-2026-06-18.json',
    },
    {
      issue: 1376,
      name: 'RAW open/edit/export runtime status',
      path: 'docs/validation/raw-open-edit-export-runtime-status-2026-06-18.json',
    },
    {
      issue: 1857,
      name: 'Professional workflow status',
      path: 'docs/validation/professional-workflow-status-2026-06-18.json',
    },
  ].map(async (source) => {
    const report = statusReportSchema.parse(JSON.parse(await readFile(source.path, 'utf8')));
    return {
      issue: source.issue,
      name: source.name,
      proofStatus: report.status,
      reportPath: source.path,
    };
  }),
);

const artifacts = [
  artifact('docs/validation/goal-review-2026-06-11.html', 'html_review'),
  artifact('docs/validation/goal-review-screenshot-2026-06-18.png', 'screenshot'),
  artifact('docs/validation/computational-merge-runtime-status-2026-06-18.json', 'runtime_status'),
  artifact('docs/validation/raw-open-edit-export-runtime-status-2026-06-18.json', 'runtime_status'),
  artifact('docs/validation/professional-workflow-status-2026-06-18.json', 'runtime_status'),
  artifact('docs/validation/layer-mask-real-raw-proof-2026-06-18.json', 'runtime_status'),
  artifact('docs/validation/negative-lab-real-render-proof-2026-06-17.json', 'runtime_status'),
  artifact('docs/validation/negative-lab-agent-workflow-proof-2026-06-16.html', 'html_review'),
  artifact('docs/validation/negative-lab-qc-contact-sheet-proof-2026-06-16.svg', 'svg_review'),
  artifact('docs/validation/public-fixture-manifest.json', 'markdown_policy'),
];

const capabilityStatuses = [
  {
    area: 'Final review page',
    evidence: 'docs/validation/goal-review-2026-06-11.html',
    issue: 2320,
    status: 'plan-only',
  },
  {
    area: 'RAW open/edit/export ledger',
    evidence: 'docs/validation/raw-open-edit-export-runtime-status-2026-06-18.json',
    issue: 1376,
    status: 'schema-only',
  },
  {
    area: 'Computational app-server bridges',
    evidence: 'docs/validation/computational-merge-runtime-status-2026-06-18.json',
    issue: 1809,
    status: 'dry-run-only',
  },
  {
    area: 'HDR/panorama/focus/SR synthetic outputs',
    evidence: 'check:computational-merge-runtime-status source reports',
    issue: 1809,
    status: 'runtime apply-capable',
  },
  {
    area: 'Goal review screenshot',
    evidence: 'docs/validation/goal-review-screenshot-2026-06-18.png',
    issue: 1856,
    status: 'UI E2E-proven',
  },
] satisfies Array<z.infer<typeof capabilityStatusSchema>>;

const report = reportSchema.parse({
  artifacts,
  capabilityStatuses,
  commands: [
    'bun run check:goal-review-data',
    'bun run check:goal-review-page',
    'bun run check:goal-review-screenshot',
    'bun run check:computational-merge-runtime-status',
    'bun run prepare:computational-private-root',
    'bun run check:computational-private-root-assets',
    'bun run prepare:hdr-real-raw-private-root',
    'bun run prepare:focus-real-raw-private-root',
    'bun run prepare:sr-real-raw-private-root',
    'bun run prepare:panorama-real-raw-private-root',
    'bun run check:raw-open-edit-export-runtime-status',
    'bun run check:professional-workflow-status',
  ],
  generatedAt: GENERATED_AT,
  issue: 1856,
  missingArtifacts: [
    'Full app walkthrough screenshots for every newly added UI surface.',
    'Private HDR ARW bracket runtime report from RAWENGINE_RUN_PRIVATE_HDR_REAL_RAW_PROOF=1.',
    'Private focus-stack CR3, super-resolution NEF, and panorama RAF source files.',
    'Real RAW panorama, focus stack, and super-resolution runtime reports after private source files exist.',
  ],
  proofHash: hashString(JSON.stringify({ artifacts, capabilityStatuses, sourceReports })),
  schemaVersion: 1,
  sourceReports,
  status: 'review_page_data_generated',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await writeFile(REPORT_PATH, reportText);
  console.log('goal review data updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:goal-review-data:update.`);
}

const existingReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:goal-review-data:update.`);
}

console.log('goal review data ok');

function artifact(
  path: string,
  proofKind: z.infer<typeof artifactSchema>['proofKind'],
): z.infer<typeof artifactSchema> {
  return {
    exists: existsSync(path),
    path,
    proofKind,
  };
}

function hashString(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
