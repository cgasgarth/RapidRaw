#!/usr/bin/env bun

import { join } from 'node:path';
import { formatCommandForLog, writeBoundedOutput } from '../lib/ci/compact-output';

const RUST_SOURCE_PATH = /^src-tauri\/src\/([a-z][a-z0-9_]*)(?:\/|\.rs$)/u;
const NON_MODULE_ROOTS = new Set(['lib', 'main']);

export const selectAffectedRustModules = (paths: readonly string[]): string[] =>
  [
    ...new Set(
      paths.flatMap((path) => {
        const module = path.match(RUST_SOURCE_PATH)?.[1];
        return module === undefined || NON_MODULE_ROOTS.has(module) ? [] : [module];
      }),
    ),
  ].sort();

export const affectedRustModuleTestCommand = (module: string): [string, ...string[]] => [
  'cargo',
  'test',
  '--quiet',
  '--locked',
  '--no-default-features',
  '--features',
  'required-ci',
  '--lib',
  `${module}::`,
];

const readStagedPaths = (root: string): string[] => {
  const result = Bun.spawnSync(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || 'unable to read staged Rust paths');
  return result.stdout.toString().split('\n').filter(Boolean);
};

interface ModuleResult {
  command: readonly string[];
  durationMs: number;
  exitCode: number;
  module: string;
  output: string;
}

const runModule = async (root: string, module: string): Promise<ModuleResult> => {
  const command = affectedRustModuleTestCommand(module);
  const startedAt = performance.now();
  const child = Bun.spawn(command, {
    cwd: join(root, 'src-tauri'),
    env: { ...process.env, CARGO_TERM_COLOR: 'never' },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {
    command,
    durationMs: performance.now() - startedAt,
    exitCode,
    module,
    output: `${stdout}\n${stderr}`.trim(),
  };
};

export const runAffectedRustModuleTests = async (root = process.cwd()): Promise<number> => {
  const modules = selectAffectedRustModules(readStagedPaths(root));
  if (modules.length === 0) {
    console.log('rust affected tests ok (no staged module namespaces)');
    return 0;
  }

  const startedAt = performance.now();
  const results = await Promise.all(modules.map((module) => runModule(root, module)));
  const failures = results.filter(({ exitCode }) => exitCode !== 0);
  if (failures.length > 0) {
    console.error(`rust affected tests failed (${failures.length}/${results.length} modules)`);
    for (const failure of failures) {
      console.error(
        `${failure.module} failed (${(failure.durationMs / 1_000).toFixed(1)}s): ${formatCommandForLog(failure.command[0] ?? 'cargo', failure.command.slice(1))}`,
      );
      writeBoundedOutput(`${failure.module} output`, failure.output);
    }
    return failures[0]?.exitCode ?? 1;
  }

  console.log(`rust affected tests ok (${modules.join(',')}; ${(performance.now() - startedAt).toFixed(0)}ms wall)`);
  return 0;
};

if (import.meta.main) process.exit(await runAffectedRustModuleTests());
