#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const PIN_MANIFEST_PATH = join(ROOT, 'docs/ci/github-actions-pins.json');
const WORKFLOW_ROOTS = [join(ROOT, '.github/workflows'), join(ROOT, '.github/actions')];
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const USES_PATTERN = /^\s*(?:-\s*)?uses:\s*([^#\s]+)(?:\s+#\s*(\S+))?/u;

function readPinManifest() {
  return JSON.parse(readFileSync(PIN_MANIFEST_PATH, 'utf8'));
}

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

function parseExternalUses() {
  const uses = [];

  for (const root of WORKFLOW_ROOTS) {
    for (const filePath of walkYamlFiles(root)) {
      const repoPath = relative(ROOT, filePath);
      const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u);

      lines.forEach((line, index) => {
        const match = line.match(USES_PATTERN);
        if (!match) return;

        const spec = match[1].replace(/^["']|["']$/gu, '');
        if (spec.startsWith('./') || spec.startsWith('docker://')) return;

        const atIndex = spec.lastIndexOf('@');
        if (atIndex < 0) {
          uses.push({ file: repoPath, line: index + 1, spec, action: spec, ref: '' });
          return;
        }

        const action = spec.slice(0, atIndex).split('/').slice(0, 2).join('/');
        const ref = spec.slice(atIndex + 1);
        uses.push({ file: repoPath, line: index + 1, spec, action, ref, commentVersion: match[2] ?? '' });
      });
    }
  }

  return uses;
}

function fail(violations) {
  if (violations.length === 0) return;

  console.error('GitHub Action pin validation failed.');
  console.error(violations.join('\n'));
  process.exit(1);
}

function checkOfflinePins(manifest) {
  const violations = [];
  const usedActions = new Set();

  for (const usage of parseExternalUses()) {
    const pin = manifest[usage.action];
    usedActions.add(usage.action);

    if (!SHA_PATTERN.test(usage.ref)) {
      violations.push(`${usage.file}:${usage.line}: ${usage.spec} must be pinned to a full 40-character SHA`);
      continue;
    }

    if (!pin) {
      violations.push(
        `${usage.file}:${usage.line}: ${usage.action} is not listed in ${relative(ROOT, PIN_MANIFEST_PATH)}`,
      );
      continue;
    }

    if (usage.ref !== pin.sha) {
      violations.push(
        `${usage.file}:${usage.line}: ${usage.action} is pinned to ${usage.ref}, expected ${pin.sha} (${pin.version})`,
      );
    }

    if (usage.commentVersion && usage.commentVersion !== pin.version) {
      violations.push(
        `${usage.file}:${usage.line}: ${usage.action} comment is ${usage.commentVersion}, expected ${pin.version}`,
      );
    }
  }

  for (const action of Object.keys(manifest)) {
    if (!usedActions.has(action)) {
      violations.push(
        `${relative(ROOT, PIN_MANIFEST_PATH)}: ${action} is listed but not used by workflows or composite actions`,
      );
    }
  }

  fail(violations);
  console.log(`Validated ${usedActions.size} pinned GitHub Action dependencies.`);
}

function parseSemverTag(tag, versionPrefix) {
  if (!tag.startsWith(versionPrefix)) return undefined;

  const parts = tag.slice(versionPrefix.length).split('.');
  if (parts.length !== 3) return undefined;
  if (!parts.every((part) => /^\d+$/u.test(part))) return undefined;

  return parts.map(Number);
}

function compareSemver(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function fetchRemoteTags(action) {
  const output = execFileSync('git', ['ls-remote', '--tags', `https://github.com/${action}.git`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tags = new Map();
  for (const line of output.trim().split('\n')) {
    if (!line) continue;

    const [sha, ref] = line.split(/\s+/u);
    const rawTag = ref.replace('refs/tags/', '');
    const isPeeled = rawTag.endsWith('^{}');
    const tag = rawTag.replace(/\^\{\}$/u, '');
    const entry = tags.get(tag) ?? {};

    if (isPeeled) {
      entry.peeledSha = sha;
    } else {
      entry.tagSha = sha;
    }

    tags.set(tag, entry);
  }

  return tags;
}

function checkLatestPins(manifest) {
  const violations = [];

  for (const [action, pin] of Object.entries(manifest)) {
    const tags = fetchRemoteTags(action);
    const stableTags = [...tags.entries()]
      .map(([tag, shas]) => ({ tag, shas, semver: parseSemverTag(tag, pin.versionPrefix) }))
      .filter((entry) => entry.semver)
      .sort((a, b) => compareSemver(a.semver, b.semver));

    const latest = stableTags.at(-1);
    if (!latest) {
      violations.push(`${action}: no stable semver tags found with prefix ${pin.versionPrefix}`);
      continue;
    }

    if (latest.tag !== pin.version) {
      violations.push(`${action}: manifest uses ${pin.version}, latest is ${latest.tag}`);
      continue;
    }

    const expectedSha = latest.shas.peeledSha ?? latest.shas.tagSha;
    if (pin.sha !== expectedSha) {
      violations.push(`${action}: ${pin.version} resolves to ${expectedSha}, manifest pins ${pin.sha}`);
    }
  }

  fail(violations);
  console.log('All GitHub Action pins match the latest stable upstream tags.');
}

const args = new Set(process.argv.slice(2));
const manifest = readPinManifest();
checkOfflinePins(manifest);

if (args.has('--check-latest')) {
  checkLatestPins(manifest);
}
