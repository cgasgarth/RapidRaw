#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules', 'src-tauri/target', 'target']);
const MARKDOWN_EXTENSION = '.md';
const EXTERNAL_TARGET_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

const isIgnored = (repoPath) => {
  const normalized = repoPath.split('/').join('/');
  return [...IGNORED_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`));
};

const walk = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const repoPath = relative(ROOT, absolutePath);
    if (isIgnored(repoPath)) continue;

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walk(absolutePath, files);
      continue;
    }

    if (stat.isFile() && extname(entry) === MARKDOWN_EXTENSION) {
      files.push(absolutePath);
    }
  }

  return files;
};

const slugifyHeading = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/gu, '-');

const getMarkdownAnchors = (filePath) => {
  const contents = readFileSync(filePath, 'utf8');
  const anchors = new Set();
  const counts = new Map();

  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (!match) continue;

    const baseSlug = slugifyHeading(match[2]);
    const count = counts.get(baseSlug) ?? 0;
    counts.set(baseSlug, count + 1);
    anchors.add(count === 0 ? baseSlug : `${baseSlug}-${count}`);
  }

  return anchors;
};

const markdownAnchors = new Map();
const getAnchorsForFile = (filePath) => {
  const cached = markdownAnchors.get(filePath);
  if (cached) return cached;

  const anchors = getMarkdownAnchors(filePath);
  markdownAnchors.set(filePath, anchors);
  return anchors;
};

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeTarget = (rawTarget) => {
  const trimmed = rawTarget.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('<')) {
    const closingIndex = trimmed.indexOf('>');
    return closingIndex >= 0 ? trimmed.slice(1, closingIndex) : trimmed.slice(1);
  }

  return trimmed.split(/\s+/u)[0];
};

const extractTargets = (contents) => {
  const targets = [];
  const inlineLinkPattern = /!?\[[^\]\n]*\]\(([^)\n]+)\)/gu;
  const referenceDefinitionPattern = /^\s{0,3}\[[^\]\n]+\]:\s+(\S+)/gmu;

  for (const match of contents.matchAll(inlineLinkPattern)) {
    targets.push(match[1]);
  }

  for (const match of contents.matchAll(referenceDefinitionPattern)) {
    targets.push(match[1]);
  }

  return targets;
};

const isExternalTarget = (target) =>
  EXTERNAL_TARGET_PATTERN.test(target) || target.startsWith('//') || target.startsWith('data:');

const toRepoPath = (filePath) => relative(ROOT, filePath).split('/').join('/');

const resolveTargetPath = (sourceFile, linkPath) => {
  if (!linkPath) return sourceFile;

  const decodedPath = safeDecode(linkPath);
  if (decodedPath.startsWith('/')) {
    return resolve(ROOT, decodedPath.slice(1));
  }

  return resolve(dirname(sourceFile), decodedPath);
};

const markdownFiles = walk(ROOT);
const failures = [];

for (const filePath of markdownFiles) {
  const contents = readFileSync(filePath, 'utf8');
  const sourceRepoPath = toRepoPath(filePath);

  for (const rawTarget of extractTargets(contents)) {
    const normalizedTarget = normalizeTarget(rawTarget);
    if (!normalizedTarget || isExternalTarget(normalizedTarget)) continue;

    const [targetPathPart, rawAnchor] = normalizedTarget.split('#');
    const targetPath = resolveTargetPath(filePath, targetPathPart);
    const targetRepoPath = toRepoPath(targetPath);

    if (!targetPath.startsWith(ROOT)) {
      failures.push(`${sourceRepoPath}: link escapes repository root: ${normalizedTarget}`);
      continue;
    }

    if (!existsSync(targetPath)) {
      failures.push(`${sourceRepoPath}: missing link target: ${normalizedTarget}`);
      continue;
    }

    if (rawAnchor && extname(targetPath) === MARKDOWN_EXTENSION) {
      const anchor = safeDecode(rawAnchor).toLowerCase();
      if (!getAnchorsForFile(targetPath).has(anchor)) {
        failures.push(`${sourceRepoPath}: missing heading anchor "${anchor}" in ${targetRepoPath}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Markdown internal link check failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Checked internal Markdown links in ${markdownFiles.length} files.`);
