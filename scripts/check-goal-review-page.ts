#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { z } from 'zod';

const REVIEW_PAGE_PATH = 'docs/validation/goal-review-2026-06-11.html';
const REVIEW_DATA_PATH = 'docs/validation/goal-review-data-2026-06-18.json';
const REVIEW_SCREENSHOT_PATH = 'docs/validation/goal-review-screenshot-2026-06-18.png';
const ROOT = process.cwd();

const requirementSchema = z
  .object({
    label: z.string().min(1),
    needles: z.array(z.string().min(1)).min(1),
  })
  .strict();

const requirements = z.array(requirementSchema).parse([
  {
    label: 'required sections',
    needles: [
      '<h2>Current Snapshot</h2>',
      '<h2>Review Checklist</h2>',
      '<h2>User-Visible Feature Proofs</h2>',
      '<h2>Artifacts</h2>',
      '<h2>Design Decisions To Track</h2>',
      '<h2>Validation Evidence Ledger</h2>',
      '<h2>Missing Artifacts</h2>',
      'goal-review-data-2026-06-18.json',
      'goal-review-screenshot-2026-06-18.png',
    ],
  },
  {
    label: 'validation commands',
    needles: [
      'bun run check:visual-smoke',
      'bun run check:hdr-runtime-plan-smoke',
      'bun run check:panorama-runtime-plan-smoke',
      'bun run check:panorama-seam-exposure-proof',
      'bun run check:panorama-projection-memory-proof',
      'bun run check:focus-runtime-plan-smoke',
      'bun run check:focus-alignment-sharpness-proof',
      'bun run check:focus-blend-halo-proof',
      'bun run check:sr-runtime-plan-smoke',
      'bun run check:sr-alignment-detail-proof',
      'bun run check:sr-artifact-performance-proof',
      'bun run check:layer-mask-real-raw-proof',
      'bun run check:raw-open-edit-export-proof',
      'bun run check:raw-open-edit-export-run-reports',
      'bun run prepare:computational-private-root',
      'bun run check:computational-private-root-assets',
      'bun run prepare:hdr-real-raw-private-root',
      'bun run prepare:focus-real-raw-private-root',
      'bun run prepare:sr-real-raw-private-root',
      'bun run prepare:panorama-real-raw-private-root',
      'bun run check:computational-merge-runtime-status',
      'bun run check:professional-workflow-status',
      'bun run check:sidecar-roundtrip',
    ],
  },
  {
    label: 'capability honesty',
    needles: [
      'Runtime apply proof',
      'Synthetic proof',
      'Private RAW report gate',
      'Aggregate computational private root prep',
      'HDR private RAW asset prep',
      'Focus private RAW asset prep',
      'Super-resolution private RAW asset prep',
      'Panorama private RAW asset prep',
      'manifest-only public schema',
      'Real RAW before/after proof',
      'negative-lab-qc-contact-sheet-proof-2026-06-16.svg',
      'Missing Artifacts',
    ],
  },
]);

const fail = (messages: string[]): never => {
  console.error(`goal review page failed (${messages.length})`);
  console.error(
    messages
      .slice(0, 20)
      .map((message) => `- ${message}`)
      .join('\n'),
  );
  process.exit(1);
};

const reviewPage = join(ROOT, REVIEW_PAGE_PATH);
if (!existsSync(reviewPage)) {
  fail([`missing ${REVIEW_PAGE_PATH}`]);
}
if (!existsSync(join(ROOT, REVIEW_DATA_PATH))) {
  fail([`missing ${REVIEW_DATA_PATH}`]);
}
if (!existsSync(join(ROOT, REVIEW_SCREENSHOT_PATH))) {
  fail([`missing ${REVIEW_SCREENSHOT_PATH}`]);
}

const html = readFileSync(reviewPage, 'utf8');
const failures: string[] = [];

for (const requirement of requirements) {
  for (const needle of requirement.needles) {
    if (!html.includes(needle)) {
      failures.push(`${requirement.label}: missing ${needle}`);
    }
  }
}

const stalePhrases = ['queued in PR', 'Queued local branch'];
for (const stalePhrase of stalePhrases) {
  if (html.includes(stalePhrase)) {
    failures.push(`stale phrase: ${stalePhrase}`);
  }
}

for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gu)) {
  const src = match[1];
  if (src === undefined || src.startsWith('http')) continue;

  const resolvedPath = normalize(join(ROOT, dirname(REVIEW_PAGE_PATH), src));
  if (!resolvedPath.startsWith(ROOT) || !existsSync(resolvedPath)) {
    failures.push(`missing image artifact: ${src}`);
  }
}

if (failures.length > 0) {
  fail(failures);
}

console.log('goal review page ok');
