#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const EXPECTED_REPO = 'cgasgarth/RapidRaw';
const EXPECTED_ORIGIN = 'https://github.com/cgasgarth/RapidRaw.git';
const EXPECTED_UPSTREAM = 'https://github.com/CyberTimon/RapidRAW.git';
const MAX_ACTIVE_PRS = 2;

const packageJsonSchema = z
  .object({
    name: z.literal('rapidraw'),
  })
  .passthrough();

const prSchema = z
  .object({
    number: z.number(),
  })
  .passthrough();

const textDecoder = new TextDecoder();

function run(command: Array<string>): { code: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync(command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {
    code: result.exitCode,
    stderr: textDecoder.decode(result.stderr).trim(),
    stdout: textDecoder.decode(result.stdout).trim(),
  };
}

function pushFailure(failures: Array<string>, message: string): void {
  failures.push(message);
}

const failures: Array<string> = [];
const cwd = resolve('.');

if (!existsSync('package.json')) {
  pushFailure(failures, 'package.json missing; run from repo root.');
} else {
  const packageJson = packageJsonSchema.safeParse(await Bun.file('package.json').json());
  if (!packageJson.success) {
    pushFailure(failures, 'package.json name must be rapidraw.');
  }
}

if (!existsSync('bun.lock')) {
  pushFailure(failures, 'bun.lock missing; run from repo root.');
}

for (const tool of ['eslint', 'prettier', 'i18next-cli']) {
  if (!existsSync(`node_modules/.bin/${tool}`)) {
    pushFailure(failures, `${tool} missing; run bun install --frozen-lockfile.`);
  }
}

const ghRepo = run(['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
if (ghRepo.code !== 0) {
  pushFailure(failures, `gh repo view failed: ${ghRepo.stderr || ghRepo.stdout}`);
} else if (ghRepo.stdout !== EXPECTED_REPO) {
  pushFailure(failures, `gh repo is ${ghRepo.stdout}; run bun run repo:fix-gh-resolution.`);
}

const topLevel = run(['git', 'rev-parse', '--show-toplevel']);
if (topLevel.code !== 0) {
  pushFailure(failures, `git root check failed: ${topLevel.stderr || topLevel.stdout}`);
} else if (resolve(topLevel.stdout) !== cwd) {
  pushFailure(failures, `run from repo root; git root is ${topLevel.stdout}, cwd is ${cwd}.`);
}

for (const [remote, expected] of [
  ['origin', EXPECTED_ORIGIN],
  ['upstream', EXPECTED_UPSTREAM],
] as const) {
  const actual = run(['git', 'remote', 'get-url', remote]);
  if (actual.code !== 0) {
    pushFailure(failures, `remote ${remote} missing; expected ${expected}.`);
  } else if (actual.stdout !== expected) {
    pushFailure(failures, `remote ${remote} is ${actual.stdout}; expected ${expected}.`);
  }
}

const branch = run(['git', 'branch', '--show-current']);
if (branch.code !== 0 || branch.stdout.length === 0) {
  pushFailure(failures, 'no current branch; checkout or create a work branch.');
}

const status = run(['git', 'status', '--porcelain']);
if (status.code !== 0) {
  pushFailure(failures, `git status failed: ${status.stderr || status.stdout}`);
}

const prList = run(['gh', 'pr', 'list', '--state', 'open', '--json', 'number', '--limit', '100']);
if (prList.code !== 0) {
  pushFailure(failures, `gh pr list failed: ${prList.stderr || prList.stdout}`);
} else {
  const parsed = z.array(prSchema).safeParse(JSON.parse(prList.stdout || '[]'));
  if (!parsed.success) {
    pushFailure(failures, 'gh pr list returned an unexpected shape.');
  } else if (parsed.data.length > MAX_ACTIVE_PRS) {
    pushFailure(failures, `open PR count ${parsed.data.length} exceeds max ${MAX_ACTIVE_PRS}.`);
  }
}

if (failures.length > 0) {
  console.error('agent preflight failed');
  for (const failure of failures.slice(0, 20)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('agent preflight ok');
