#!/usr/bin/env bun

import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOKS_PATH = '.githooks';
const REQUIRED_HOOKS = ['pre-commit', 'pre-push'];

const run = async (command, args, options = {}) => {
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    stderr: 'pipe',
    stdin: options.stdin ? 'pipe' : 'ignore',
    stdout: 'pipe',
  });
  if (options.stdin && proc.stdin) {
    proc.stdin.write(options.stdin);
    proc.stdin.end();
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return { exitCode, stderr, stdout };
};

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const isExecutable = (path) => (statSync(path).mode & 0o111) !== 0;

const verifyHooks = async () => {
  const hooksPath = (await run('git', ['config', '--get', 'core.hooksPath'])).stdout.trim();
  if (hooksPath !== HOOKS_PATH) {
    fail(`hooks path mismatch (${hooksPath || '<unset>'})`);
  }

  const missing = REQUIRED_HOOKS.filter((hook) => !existsSync(join(HOOKS_PATH, hook)));
  if (missing.length > 0) {
    fail(`missing hooks: ${missing.join(', ')}`);
  }

  const nonExecutable = REQUIRED_HOOKS.filter((hook) => !isExecutable(join(HOOKS_PATH, hook)));
  if (nonExecutable.length > 0) {
    fail(`non-executable hooks: ${nonExecutable.join(', ')}`);
  }

  console.log(`hooks verify ok (${REQUIRED_HOOKS.length})`);
};

const expectExit = (label, result, expectedExitCode) => {
  if (result.exitCode !== expectedExitCode) {
    fail(`${label} expected exit ${expectedExitCode}, got ${result.exitCode}`);
  }
};

const runSelfTest = async () => {
  const mainPush = await run('sh', [join(HOOKS_PATH, 'pre-push')], {
    stdin: 'refs/heads/main abc refs/heads/main def\n',
  });
  expectExit('main pre-push', mainPush, 1);

  const featurePush = await run('sh', [join(HOOKS_PATH, 'pre-push')], {
    stdin: 'refs/heads/codex/example abc refs/heads/codex/example def\n',
  });
  expectExit('feature pre-push', featurePush, 0);

  const tempRepo = mkdtempSync(join(tmpdir(), 'rapidraw-hook-test-'));
  try {
    const init = await run('git', ['init', '--initial-branch=main'], { cwd: tempRepo });
    expectExit('temp git init', init, 0);
    const preCommitMain = await run('sh', [join(process.cwd(), HOOKS_PATH, 'pre-commit')], { cwd: tempRepo });
    expectExit('main pre-commit', preCommitMain, 1);
  } finally {
    await rm(tempRepo, { force: true, recursive: true });
  }

  const stagedCheckerSource = await Bun.file('tests/integration/checks/check-staged-files.ts').text();
  if (!stagedCheckerSource.includes("['run', 'i18n:lint']")) {
    fail('pre-commit staged i18n path must run i18n:lint, not only i18n:check');
  }

  console.log('hooks self-test ok');
};

if (process.argv.includes('--self-test')) {
  await runSelfTest();
} else {
  await verifyHooks();
}
