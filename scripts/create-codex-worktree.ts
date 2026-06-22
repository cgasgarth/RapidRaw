#!/usr/bin/env bun

import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import process from 'node:process';

type RunOptions = {
  cwd?: string;
  allowFailure?: boolean;
};

type ParsedArgs = {
  branch: string;
  dryRun: boolean;
  path: string;
};

type GitWorktree = {
  branch?: string;
  path: string;
};

type WorktreeSource = {
  hasMainWorktree: boolean;
  root: string;
};

const REPO_OWNER = 'cgasgarth/RapidRaw';
const ORIGIN_URL = 'https://github.com/cgasgarth/RapidRaw.git';
const UPSTREAM_URL = 'https://github.com/CyberTimon/RapidRAW.git';

const usage = `Usage: bun run worktree:create -- --branch codex/name [--path ../RapidRaw-name] [--dry-run]

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

const parseArgs = (args = process.argv.slice(2)): ParsedArgs => {
  let branch = '';
  let dryRun = false;
  let path = '';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--help' || arg === '-h') {
      console.log(usage);
      process.exit(0);
    }

    if (arg === '--self-test') {
      runSelfTest();
      process.exit(0);
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
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
    dryRun,
    path: path || `../RapidRaw-${branch.replace(/^codex\//u, '').replace(/[^a-zA-Z0-9._-]+/gu, '-')}`,
  };
};

const runSelfTest = (): void => {
  assert.deepEqual(parseArgs(['--branch', 'codex/example']), {
    branch: 'codex/example',
    dryRun: false,
    path: '../RapidRaw-example',
  });
  assert.deepEqual(parseArgs(['--branch', 'codex/issue-123', '--path', '../custom', '--dry-run']), {
    branch: 'codex/issue-123',
    dryRun: true,
    path: '../custom',
  });
  assert.throws(() => parseArgs([]), /Missing --branch/u);
  assert.throws(() => parseArgs(['--branch', 'feature/example']), /codex\/ prefix/u);
  assert.deepEqual(
    parseWorktrees(
      'worktree /repo/main\nbranch refs/heads/main\n\nworktree /repo/feature\nbranch refs/heads/codex/test',
    ),
    [
      { branch: 'main', path: '/repo/main' },
      { branch: 'codex/test', path: '/repo/feature' },
    ],
  );
  console.log('worktree helper self-test ok');
};

const ensureRepoRoot = (root: string): void => {
  const packageJsonPath = resolve(root, 'package.json');
  if (!existsSync(packageJsonPath)) throw new Error('package.json not found; run from a RapidRaw checkout root');
  if (!existsSync(resolve(root, 'bun.lock'))) throw new Error('bun.lock not found; run from a RapidRaw checkout root');

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
  if (packageJson.name !== 'rapidraw') {
    throw new Error(`Expected package name rapidraw, found ${packageJson.name ?? 'missing'}`);
  }

  const repoRoot = run(['git', 'rev-parse', '--show-toplevel'], { cwd: root });
  if (repoRoot !== root) throw new Error(`Run from the checkout root, not a subdirectory: ${repoRoot}`);
};

const parseWorktrees = (output: string): GitWorktree[] =>
  output
    .split(/\n\n/u)
    .map((entry) => {
      const lines = entry.split('\n');
      const pathLine = lines.find((line) => line.startsWith('worktree '));
      if (!pathLine) return undefined;
      const branchLine = lines.find((line) => line.startsWith('branch refs/heads/'));
      return {
        branch: branchLine?.replace('branch refs/heads/', ''),
        path: pathLine.replace('worktree ', ''),
      };
    })
    .filter((worktree): worktree is GitWorktree => Boolean(worktree));

const findWorktreeSource = (root: string): WorktreeSource => {
  const worktrees = parseWorktrees(run(['git', 'worktree', 'list', '--porcelain'], { cwd: root }));
  const mainWorktree = worktrees.find((worktree) => worktree.branch === 'main');
  return mainWorktree ? { hasMainWorktree: true, root: mainWorktree.path } : { hasMainWorktree: false, root };
};

const ensureMainReady = (mainRoot: string): void => {
  const currentBranch = run(['git', 'branch', '--show-current'], { cwd: mainRoot });
  if (currentBranch !== 'main')
    throw new Error(`Expected main worktree at ${mainRoot}, found ${currentBranch || 'detached HEAD'}`);

  const status = run(['git', 'status', '--short'], { cwd: mainRoot });
  if (status) throw new Error(`Main worktree has uncommitted changes: ${mainRoot}`);
};

const ensureTool = (tool: string): void => {
  run([tool, '--version']);
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
  ensureDependencyBins(root, () => {
    console.log('deps missing; running bun install --frozen-lockfile');
    run(['bun', 'install', '--frozen-lockfile'], { cwd: root });
  });
};

const ensureDependencyBins = (root: string, install?: () => void): void => {
  const nodeModules = resolve(root, 'node_modules');
  const eslintBin = resolve(nodeModules, '.bin/eslint');
  const prettierBin = resolve(nodeModules, '.bin/prettier');
  const i18nBin = resolve(nodeModules, '.bin/i18next-cli');

  if (existsSync(eslintBin) && existsSync(prettierBin) && existsSync(i18nBin)) return;

  install?.();

  if (!existsSync(eslintBin) || !existsSync(prettierBin) || !existsSync(i18nBin)) {
    throw new Error(`Required dependency bins are missing under ${nodeModules}`);
  }
};

const updateMain = (source: WorktreeSource): void => {
  if (source.hasMainWorktree) {
    ensureMainReady(source.root);
    run(['git', 'fetch', 'origin', 'main'], { cwd: source.root });
    run(['git', 'pull', '--ff-only', 'origin', 'main'], { cwd: source.root });
    return;
  }

  run(['git', 'fetch', 'origin', 'main'], { cwd: source.root });
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

const configureWorktreeGit = (worktreePath: string, branch: string): void => {
  run(['git', 'config', 'core.hooksPath', '.githooks'], { cwd: worktreePath });
  run(['git', 'config', 'pull.ff', 'only'], { cwd: worktreePath });
  run(['git', 'config', 'remote.pushDefault', 'origin'], { cwd: worktreePath });
  run(['git', 'config', `branch.${branch}.remote`, 'origin'], { cwd: worktreePath });
  run(['git', 'config', `branch.${branch}.merge`, `refs/heads/${branch}`], { cwd: worktreePath });
};

const ensureWorktreeReady = (worktreePath: string, branch: string): void => {
  const currentBranch = run(['git', 'branch', '--show-current'], { cwd: worktreePath });
  if (currentBranch !== branch) throw new Error(`Expected ${branch}, found ${currentBranch || 'detached HEAD'}`);
  ensureDependencyBins(worktreePath);
  run(['bun', 'run', 'hooks:verify'], { cwd: worktreePath });
  run(['bun', 'run', 'check:gh-repo-resolution'], { cwd: worktreePath });
};

const main = (): void => {
  const root = process.cwd();
  const { branch, dryRun, path } = parseArgs();
  const worktreePath = isAbsolute(path) ? path : resolve(root, path);

  ensureTool('bun');
  ensureTool('git');
  ensureTool('gh');
  ensureRepoRoot(root);
  const source = findWorktreeSource(root);
  ensureRemote(source.root, 'origin', ORIGIN_URL);
  ensureRemote(source.root, 'upstream', UPSTREAM_URL);
  ensurePrimaryDependencies(source.root);

  if (existsSync(worktreePath)) throw new Error(`Worktree path already exists: ${worktreePath}`);

  if (dryRun) {
    run(['git', 'fetch', 'origin', 'main'], { cwd: source.root });
    console.log(`worktree create dry-run ok: ${worktreePath} (${branch})`);
    return;
  }

  updateMain(source);

  mkdirSync(dirname(worktreePath), { recursive: true });
  run(['git', 'worktree', 'add', '-b', branch, worktreePath, 'origin/main'], { cwd: source.root });
  linkNodeModules(source.root, worktreePath);
  configureWorktreeGit(worktreePath, branch);
  ensureGhResolution(worktreePath);
  ensureWorktreeReady(worktreePath, branch);

  console.log(`worktree ready: ${worktreePath} (${branch})`);
};

try {
  main();
} catch (error) {
  console.error('worktree create failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
