#!/usr/bin/env bun
// @ts-check

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const labelSchema = z.object({
  name: z.string().min(1),
});

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  mergedAt: z.string().optional().nullable(),
  url: z.string().url().optional().nullable(),
  author: z
    .object({
      login: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  labels: z.array(labelSchema).default([]),
});

const pullRequestsSchema = z.array(pullRequestSchema);

const CATEGORY_ORDER = [
  'Breaking Changes',
  'Features',
  'Fixes',
  'Validation And CI',
  'Security',
  'Release And Packaging',
  'Docs',
  'Other',
];

const CATEGORY_RULES = [
  {
    category: 'Breaking Changes',
    matches: ({ labels, title }) => labels.has('breaking-change') || /^[a-z-]+(?:\([^)]+\))?!:/u.test(title),
  },
  {
    category: 'Security',
    matches: ({ labels, prefix }) => labels.has('type:security') || prefix === 'security',
  },
  {
    category: 'Validation And CI',
    matches: ({ labels, prefix }) =>
      labels.has('area:validation') ||
      labels.has('validation:build') ||
      labels.has('validation:lint') ||
      ['ci', 'deps', 'tooling', 'validation'].includes(prefix),
  },
  {
    category: 'Release And Packaging',
    matches: ({ labels, prefix }) => labels.has('area:release') || ['build', 'release'].includes(prefix),
  },
  {
    category: 'Docs',
    matches: ({ labels, prefix }) => labels.has('area:docs') || prefix === 'docs',
  },
  {
    category: 'Fixes',
    matches: ({ prefix }) => ['fix', 'perf'].includes(prefix),
  },
  {
    category: 'Features',
    matches: ({ prefix }) =>
      [
        'agent',
        'ai',
        'api',
        'color',
        'export',
        'feat',
        'film',
        'focus',
        'hdr',
        'import',
        'layers',
        'library',
        'metadata',
        'negative-lab',
        'panorama',
        'sr',
        'tethering',
        'ui',
      ].includes(prefix),
  },
];

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--input':
        parsed.input = args[index + 1];
        index += 1;
        break;
      case '--output':
        parsed.output = args[index + 1];
        index += 1;
        break;
      case '--since':
        parsed.since = args[index + 1];
        index += 1;
        break;
      case '--title':
        parsed.title = args[index + 1];
        index += 1;
        break;
      case '--self-test':
        parsed.selfTest = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function getPrefix(title) {
  const match = title.match(/^([a-z][a-z0-9-]*)(?:\([^)]+\))?!?:/u);
  return match?.[1] ?? '';
}

function categorizePullRequest(pullRequest) {
  const labels = new Set(pullRequest.labels.map((label) => label.name));
  const context = {
    labels,
    prefix: getPrefix(pullRequest.title),
    title: pullRequest.title,
  };

  return CATEGORY_RULES.find((rule) => rule.matches(context))?.category ?? 'Other';
}

function parseSinceDate(since) {
  if (!since) return undefined;

  const date = new Date(since);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --since date: ${since}`);
  }

  return date;
}

function isAtOrAfter(pullRequest, sinceDate) {
  if (!sinceDate || !pullRequest.mergedAt) return true;

  const mergedAt = new Date(pullRequest.mergedAt);
  if (Number.isNaN(mergedAt.getTime())) {
    throw new Error(`Invalid mergedAt date for PR #${pullRequest.number}: ${pullRequest.mergedAt}`);
  }

  return mergedAt >= sinceDate;
}

function formatPullRequestLine(pullRequest) {
  const author = pullRequest.author?.login ? ` by @${pullRequest.author.login}` : '';
  const reference = pullRequest.url ? `[#${pullRequest.number}](${pullRequest.url})` : `#${pullRequest.number}`;
  return `- ${pullRequest.title} ${reference}${author}`;
}

export function generateReleaseNotes({ pullRequests, since, title = 'RawEngine Release Notes', generatedAt }) {
  const parsedPullRequests = pullRequestsSchema.parse(pullRequests);
  const sinceDate = parseSinceDate(since);
  const includedPullRequests = parsedPullRequests
    .filter((pullRequest) => isAtOrAfter(pullRequest, sinceDate))
    .toSorted((left, right) => {
      const leftDate = left.mergedAt ?? '';
      const rightDate = right.mergedAt ?? '';
      return rightDate.localeCompare(leftDate) || right.number - left.number;
    });

  const groups = new Map(CATEGORY_ORDER.map((category) => [category, []]));

  for (const pullRequest of includedPullRequests) {
    groups.get(categorizePullRequest(pullRequest))?.push(pullRequest);
  }

  const lines = [
    `# ${title}`,
    '',
    `Generated: ${generatedAt ?? new Date().toISOString()}`,
    `Merged pull requests: ${includedPullRequests.length}`,
  ];

  if (sinceDate) {
    lines.push(`Since: ${sinceDate.toISOString()}`);
  }

  lines.push('', '## Summary');

  for (const category of CATEGORY_ORDER) {
    const count = groups.get(category)?.length ?? 0;
    if (count > 0) {
      lines.push(`- ${category}: ${count}`);
    }
  }

  for (const category of CATEGORY_ORDER) {
    const pullRequestsForCategory = groups.get(category) ?? [];
    if (pullRequestsForCategory.length === 0) continue;

    lines.push('', `## ${category}`);
    lines.push(...pullRequestsForCategory.map(formatPullRequestLine));
  }

  if (includedPullRequests.length === 0) {
    lines.push('', '## Changes', '- No merged pull requests matched the selected range.');
  }

  return `${lines.join('\n')}\n`;
}

function readPullRequests(inputPath) {
  if (!inputPath) {
    throw new Error('Missing required --input value.');
  }

  return JSON.parse(readFileSync(inputPath, 'utf8'));
}

function writeReleaseNotes(outputPath, contents) {
  if (!outputPath) {
    process.stdout.write(contents);
    return;
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, contents);
  console.log(`Generated ${outputPath}`);
}

function runSelfTest() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'rapidraw-release-notes-'));

  try {
    const inputPath = path.join(fixtureRoot, 'prs.json');
    const outputPath = path.join(fixtureRoot, 'release-notes.md');
    const fixturePullRequests = [
      {
        number: 12,
        title: 'ui(film): add film look browser',
        mergedAt: '2026-06-13T12:00:00Z',
        url: 'https://github.com/cgasgarth/RapidRaw/pull/12',
        author: { login: 'codex' },
        labels: [{ name: 'area:frontend' }],
      },
      {
        number: 11,
        title: 'ci(release): add release gate',
        mergedAt: '2026-06-13T11:00:00Z',
        url: 'https://github.com/cgasgarth/RapidRaw/pull/11',
        author: { login: 'codex' },
        labels: [{ name: 'area:validation' }],
      },
      {
        number: 10,
        title: 'docs(plan): update PRD',
        mergedAt: '2026-06-12T11:00:00Z',
        url: 'https://github.com/cgasgarth/RapidRaw/pull/10',
        author: { login: 'codex' },
        labels: [{ name: 'area:docs' }],
      },
    ];

    writeFileSync(inputPath, `${JSON.stringify(fixturePullRequests, null, 2)}\n`);

    const notes = generateReleaseNotes({
      pullRequests: readPullRequests(inputPath),
      since: '2026-06-13T00:00:00Z',
      title: 'Self-Test Release',
      generatedAt: '2026-06-13T12:30:00.000Z',
    });

    writeReleaseNotes(outputPath, notes);

    const output = readFileSync(outputPath, 'utf8');
    const expectations = [
      '# Self-Test Release',
      '- Features: 1',
      '- Validation And CI: 1',
      'ui(film): add film look browser',
      'ci(release): add release gate',
    ];

    for (const expected of expectations) {
      if (!output.includes(expected)) {
        throw new Error(`Release notes self-test output missed expected text: ${expected}`);
      }
    }

    if (output.includes('docs(plan): update PRD')) {
      throw new Error('Release notes self-test did not filter entries before --since.');
    }

    console.log('generate-release-notes self-test passed');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.selfTest) {
  runSelfTest();
} else {
  writeReleaseNotes(
    args.output,
    generateReleaseNotes({
      pullRequests: readPullRequests(args.input),
      since: args.since,
      title: args.title,
    }),
  );
}
