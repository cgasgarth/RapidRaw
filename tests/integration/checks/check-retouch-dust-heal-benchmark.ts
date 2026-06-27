#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

const reportPath = 'docs/validation/retouch-dust-heal-benchmark-2026-06-26.json';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const metricSchema = z.object({
  name: z.string(),
  passed: z.literal(true),
  threshold: z.number(),
  value: z.number(),
});
const reportSchema = z.object({
  caseArtifacts: z
    .array(
      z.object({
        caseId: z.string().regex(/^dust-corpus-\d{2}$/u),
        healExportHash: sha256Schema,
        healPreviewHash: sha256Schema,
        publicRepoAllowed: z.literal(false),
      }),
    )
    .min(3),
  consultDecision: z.object({
    accepted: z.array(z.string()).min(3),
    rejected: z.array(z.string()).min(3),
  }),
  issue: z.literal(3770),
  metrics: z.array(metricSchema).min(10),
  privateSource: z.object({
    corpusCaseCount: z.number().int().min(3),
    hash: sha256Schema,
    publicRepoAllowed: z.literal(false),
    root: z.literal('/Users/cgas/Pictures/Capture One/Alaska'),
    selectedRawName: z.string().min(1),
  }),
  proofClaims: z.object({
    doesNotProve: z.array(z.string()).min(3),
    proves: z.array(z.string()).min(4),
  }),
  sourceIssue: z.literal(3255),
  validationMode: z.literal('private_raw_native_dust_heal_benchmark_corpus_preview_export_proof'),
});

const report = reportSchema.parse(JSON.parse(readFileSync(reportPath, 'utf8')));
const metrics = new Map(report.metrics.map((metric) => [metric.name, metric]));

const requireMetric = (name: string, predicate: (value: number, threshold: number) => boolean) => {
  const metric = metrics.get(name);
  if (metric === undefined) throw new Error(`Missing dust heal benchmark metric: ${name}`);
  if (!predicate(metric.value, metric.threshold)) {
    throw new Error(
      `Dust heal benchmark metric ${name} failed gate: value=${metric.value}, threshold=${metric.threshold}`,
    );
  }
};

requireMetric('dust_corpus_raw_count', (value, threshold) => value >= 3 && threshold >= 3);
requireMetric('dust_corpus_precision_mean', (value, threshold) => value >= threshold && value >= 0.999);
requireMetric('dust_corpus_recall_mean', (value, threshold) => value >= threshold && value >= 0.999);
requireMetric('dust_corpus_false_texture_damage_rate_max', (value, threshold) => value <= threshold);
requireMetric('dust_corpus_preview_export_delta_max', (value, threshold) => value <= threshold);
requireMetric('dust_corpus_source_hash_unchanged_ratio', (value, threshold) => value >= threshold);
requireMetric('dust_benchmark_batch_latency_ms', (value, threshold) => value > 0 && value <= threshold);
requireMetric('heal_changed_pixel_ratio', (value, threshold) => value > threshold);
requireMetric('heal_preview_export_mean_abs_delta', (value, threshold) => value <= threshold);
requireMetric('source_hash_unchanged', (value, threshold) => value >= threshold);

const distinctCaseIds = new Set(report.caseArtifacts.map((artifact) => artifact.caseId));
if (distinctCaseIds.size !== report.caseArtifacts.length) {
  throw new Error('Dust heal benchmark case artifact IDs must be unique.');
}
if (report.caseArtifacts.length !== report.privateSource.corpusCaseCount) {
  throw new Error('Dust heal benchmark artifact count must match private corpus case count.');
}
if (!report.proofClaims.proves.some((claim) => claim.includes('preview and export'))) {
  throw new Error('Dust heal benchmark must explicitly prove preview/export parity.');
}
if (!report.proofClaims.proves.some((claim) => claim.includes('source RAW files remain unchanged'))) {
  throw new Error('Dust heal benchmark must explicitly prove source RAW immutability.');
}
if (!report.proofClaims.doesNotProve.some((claim) => claim.includes('manually annotated dust corpus maturity'))) {
  throw new Error('Dust heal benchmark must keep annotation maturity limits explicit.');
}

console.log(`retouch dust heal benchmark ok (${report.caseArtifacts.length} private RAW cases)`);
