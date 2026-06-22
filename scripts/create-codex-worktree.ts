#!/usr/bin/env bun

import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';

type RunOptions = {
  cwd?: string;
  allowFailure?: boolean;
};

type ParsedArgs = {
  branch: string;
  path: string;
};

const REPO_OWNER = 'cgasgarth/RapidRaw';
const ORIGIN_URL = 'https://github.com/cgasgarth/RapidRaw.git';
const UPSTREAM_URL = 'https://github.com/CyberTimon/RapidRAW.git';

const usage = `Usage: bun run worktree:create -- --branch codex/name [--path ../RapidRaw-name]

Creates a Codex-ready worktree from current origin/main, wires dependencies, hooks, and gh repo resolution.`;

const run = (command: readonly string[], options: RunOptions = {}): string => {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();

  if (result.exitCode !== 0 && !options.allowFailure) {
    throw new Error(`${command.join(' ')} failed${stderr || stdout ? `: ${stderr || stdout}` : ''}`);
  }

  return stdout;
};

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  let branch = '';
  let path = '';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--help' || arg === '-h') {
      console.log(usage);
      process.exit(0);
    }

    if (arg === '--branch') {
      if (!next) throw new Error('Missing value for --branch');
      branch = next;
      index += 1;
      continue;
    }

    if (arg === '--path') {
      if (!next) throw new Error('Missing value for --path');
      path = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!branch) throw new Error('Missing --branch');
  if (!branch.startsWith('codex/')) throw new Error('Branch must use codex/ prefix');

  return {
    branch,
    path: path || `../RapidRaw-${branch.replace(/^codex\//u, '').replace(/[^a-zA-Z0-9._-]+/gu, '-')}`,
  };
};

const ensureRepoRoot = (root: string): void => {
  const packageJsonPath = resolve(root, 'package.json');
  if (!existsSync(packageJsonPath)) throw new Error('package.json not found; run from RapidRaw repo root');

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
  if (packageJson.name !== 'rapidraw') {
    throw new Error(`Expected package name rapidraw, found ${packageJson.name ?? 'missing'}`);
  }

  const repoRoot = run(['git', 'rev-parse', '--show-toplevel'], { cwd: root });
  if (basename(repoRoot) !== 'RapidRaw') throw new Error(`Expected RapidRaw repo root, found ${repoRoot}`);
};

const ensureMainClean = (root: string): void => {
  const status = run(['git', 'status', '--short'], { cwd: root });
  if (status) throw new Error('Working tree has uncommitted changes; commit/stash before creating a worktree');
};

const ensureRemote = (root: string, name: string, url: string): void => {
  const existing = run(['git', 'remote', 'get-url', name], { allowFailure: true, cwd: root });
  if (existing) {
    if (existing !== url) run(['git', 'remote', 'set-url', name, url], { cwd: root });
    return;
  }

  run(['git', 'remote', 'add', name, url], { cwd: root });
};

const ensurePrimaryDependencies = (root: string): void => {
  const nodeModules = resolve(root, 'node_modules');
  const eslintBin = resolve(nodeModules, '.bin/eslint');
  const prettierBin = resolve(nodeModules, '.bin/prettier');
  const i18nBin = resolve(nodeModules, '.bin/i18next-cli');

  if (existsSync(eslintBin) && existsSync(prettierBin) && existsSync(i18nBin)) return;

  console.log('deps missing; running bun install --frozen-lockfile');
  run(['bun', 'install', '--frozen-lockfile'], { cwd: root });
};

const linkNodeModules = (root: string, worktreePath: string): void => {
  const source = resolve(root, 'node_modules');
  const target = resolve(worktreePath, 'node_modules');
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || stat.isDirectory()) return;
    throw new Error(`${target} exists and is not a directory or symlink`);
  }

  symlinkSync(source, target, 'dir');
};

const ensureGhResolution = (worktreePath: string): void => {
  const resolvedRepo = run(['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
    allowFailure: true,
    cwd: worktreePath,
  });

  if (resolvedRepo === REPO_OWNER) return;

  run(['bun', 'run', 'repo:fix-gh-resolution'], { cwd: worktreePath });
  const fixedRepo = run(['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
    cwd: worktreePath,
  });
  if (fixedRepo !== REPO_OWNER) throw new Error(`gh resolved ${fixedRepo || 'nothing'}, expected ${REPO_OWNER}`);
};

const main = (): void => {
  const root = process.cwd();
  const { branch, path } = parseArgs();
  const worktreePath = isAbsolute(path) ? path : resolve(root, path);

  ensureRepoRoot(root);
  ensureMainClean(root);
  ensureRemote(root, 'origin', ORIGIN_URL);
  ensureRemote(root, 'upstream', UPSTREAM_URL);
  ensurePrimaryDependencies(root);

  if (existsSync(worktreePath)) throw new Error(`Worktree path already exists: ${worktreePath}`);

  run(['git', 'fetch', 'origin', 'main'], { cwd: root });
  run(['git', 'switch', 'main'], { cwd: root });
  run(['git', 'pull', '--ff-only', 'origin', 'main'], { cwd: root });

  mkdirSync(dirname(worktreePath), { recursive: true });
  run(['git', 'worktree', 'add', '-b', branch, worktreePath, 'origin/main'], { cwd: root });
  linkNodeModules(root, worktreePath);
  run(['git', 'config', 'core.hooksPath', '.githooks'], { cwd: worktreePath });
  ensureGhResolution(worktreePath);

  console.log(`worktree ready: ${worktreePath}`);
};

try {
  main();
} catch (error) {
  console.error('worktree create failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
