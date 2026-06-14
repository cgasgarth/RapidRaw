#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';
import { dirname, normalize, resolve } from 'node:path';

const REVIEW_PAGE = 'docs/validation/goal-review-2026-06-11.html';
const PLAN_FILE = 'RAW_EDITOR_PLAN.md';

const html = readFileSync(REVIEW_PAGE, 'utf8');
const plan = readFileSync(PLAN_FILE, 'utf8');
const reviewDir = dirname(REVIEW_PAGE);

const failures = [];

const requireIncludes = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`Missing ${label}: ${needle}`);
};

const requiredPlanRequirements = [
  'stable documented path',
  'summarize every new user-visible feature',
  'test/validation section',
  'include design decisions the user would want to know',
  'clearly list missing sections, missing screenshots, and follow-up issues',
];

for (const requirement of requiredPlanRequirements) {
  requireIncludes(plan, requirement, 'RAW_EDITOR_PLAN review-page requirement');
}

const requiredPageText = [
  '<title>RawEngine Goal Review</title>',
  '<h1>RawEngine Goal Review</h1>',
  '<h2>Current Snapshot</h2>',
  '<h2>Review Checklist</h2>',
  '<h2>Artifacts</h2>',
  '<h2>Design Decisions To Track</h2>',
  '<h2>Open Gaps</h2>',
  'Snapshot: 2026-06-11',
  'Issue: #452',
  'Local review artifact',
  'Offline-first',
  'Do not fabricate screenshots.',
];

for (const text of requiredPageText) {
  requireIncludes(html, text, 'goal review page text');
}

const linkPattern = /<a\s+[^>]*href="([^"]+)"/gu;
for (const match of html.matchAll(linkPattern)) {
  const href = match[1];
  if (/^(?:https?:|mailto:|#)/u.test(href)) continue;

  const target = normalize(resolve(reviewDir, href));
  if (!existsSync(target)) failures.push(`Broken local link in ${REVIEW_PAGE}: ${href}`);
}

const imagePattern = /<img\s+[^>]*src="([^"]+)"/gu;
for (const match of html.matchAll(imagePattern)) {
  const src = match[1];
  if (/^(?:https?:|data:)/u.test(src)) continue;

  const target = normalize(resolve(reviewDir, src));
  if (!existsSync(target)) failures.push(`Broken local image in ${REVIEW_PAGE}: ${src}`);
}

if (failures.length > 0) {
  console.error('Goal review page validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Goal review page validation passed for ${REVIEW_PAGE}.`);
