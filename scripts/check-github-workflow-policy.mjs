#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const WORKFLOW_DIR = join(ROOT, '.github/workflows');

function* walkYamlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const stat = statSync(absolutePath);

    if (stat.isDirectory()) {
      yield* walkYamlFiles(absolutePath);
      continue;
    }

    if (stat.isFile() && ['.yaml', '.yml'].includes(extname(entry))) {
      yield absolutePath;
    }
  }
}

const stripComment = (line) => line.replace(/\s+#.*$/u, '');
const indentation = (line) => line.match(/^\s*/u)?.[0].length ?? 0;
const hasMainListEntry = (line) => /^\s*-\s*['"]?main['"]?\s*$/u.test(stripComment(line));
const hasConcurrencyKey = (line) => /^\s*concurrency\s*:/u.test(stripComment(line));

function getTopLevelSection(lines, key) {
  const startIndex = lines.findIndex((line) => new RegExp(`^${key}:`, 'u').test(stripComment(line)));
  if (startIndex < 0) return [];

  const section = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && indentation(line) === 0) break;
    section.push({ line, number: index + 1 });
  }

  return section;
}

function hasMainPushTrigger(lines) {
  const inlineOn = lines.find((line) => /^on:\s+/u.test(stripComment(line)));
  if (inlineOn && /\bpush\b/u.test(inlineOn)) {
    return true;
  }

  const onSection = getTopLevelSection(lines, 'on');
  const pushIndex = onSection.findIndex(({ line }) => /^\s*push\s*:/u.test(stripComment(line)));
  if (pushIndex < 0) {
    return onSection.some(({ line }) => /^\s*-\s*push\s*$/u.test(stripComment(line)));
  }

  const pushIndent = indentation(onSection[pushIndex].line);
  const pushBlock = [];
  for (let index = pushIndex + 1; index < onSection.length; index += 1) {
    const entry = onSection[index];
    if (entry.line.trim() && indentation(entry.line) <= pushIndent) break;
    pushBlock.push(entry);
  }

  if (pushBlock.length === 0) {
    return true;
  }

  const branchIndex = pushBlock.findIndex(({ line }) => /^\s*branches\s*:/u.test(stripComment(line)));
  if (branchIndex < 0) {
    return true;
  }

  const branchIndent = indentation(pushBlock[branchIndex].line);
  const branchBlock = [];
  for (let index = branchIndex + 1; index < pushBlock.length; index += 1) {
    const entry = pushBlock[index];
    if (entry.line.trim() && indentation(entry.line) <= branchIndent) break;
    branchBlock.push(entry);
  }

  return branchBlock.some(({ line }) => hasMainListEntry(line));
}

const violations = [];

for (const file of walkYamlFiles(WORKFLOW_DIR)) {
  const repoPath = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);

  if (!hasMainPushTrigger(lines)) continue;

  lines.forEach((line, index) => {
    if (hasConcurrencyKey(line)) {
      violations.push(
        `${repoPath}:${index + 1}: workflows that run on push to main must not define concurrency; main runs must proceed independently`,
      );
    }
  });
}

if (violations.length > 0) {
  console.error('GitHub workflow policy validation failed.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Validated GitHub workflow policies.');
