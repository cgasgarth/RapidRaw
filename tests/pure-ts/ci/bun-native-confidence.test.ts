import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BUN_COVERAGE_FLOORS, enforceCoverageFloors, summarizeLcov } from '../../../scripts/ci/check-bun-coverage.ts';
import {
  buildRandomizedTestArgs,
  RANDOMIZED_SUITE_RUN_COUNT,
  randomizedTestReproduction,
  resolveRandomizedTestSeed,
} from '../../../scripts/ci/run-bun-randomized-tests.ts';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function captured(command: string[], options: { cwd: string; env?: Record<string, string> }) {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
}

describe('Bun native confidence gates', () => {
  test('uses native parallel randomization with a stable exact reproduction command', () => {
    const seed = resolveRandomizedTestSeed('424242');
    expect(seed).toBe(424242);
    expect(resolveRandomizedTestSeed('github-run-42')).toBe(resolveRandomizedTestSeed('github-run-42'));
    expect(buildRandomizedTestArgs(seed)).toEqual([
      'test',
      '--no-orphans',
      '--reporter=dot',
      '--parallel',
      '--randomize',
      '--seed=424242',
      'tests/pure-ts',
    ]);
    expect(RANDOMIZED_SUITE_RUN_COUNT).toBe(2);
    expect(randomizedTestReproduction(seed)).toBe('RAWENGINE_BUN_TEST_SEED=424242 bun run test:randomized');
  });

  test('fails closed when Bun native coverage misses its configured threshold', async () => {
    const directory = await temporaryDirectory('rapidraw-bun-coverage-gate-');
    await Bun.write(
      join(directory, 'source.ts'),
      'export function covered() {\n  return "covered";\n}\nexport function uncovered() {\n  return "uncovered";\n}\n',
    );
    await Bun.write(
      join(directory, 'source.test.ts'),
      'import { expect, test } from "bun:test";\nimport { covered } from "./source";\ntest("covered function", () => expect(covered()).toBe("covered"));\n',
    );
    await Bun.write(join(directory, 'bunfig.toml'), '[test]\ncoverageThreshold = 1.0\ncoverageSkipTestFiles = true\n');

    const result = await captured(['bun', 'test', '--coverage', 'source.test.ts'], { cwd: directory });
    if (result.exitCode === 0) throw new Error(`Expected Bun coverage threshold failure:\n${result.output}`);
    expect(result.output).toContain('All files');
    expect(result.output).toContain('50.00');
  });

  test('prints the seed and exact reproduction command before a randomized failure', async () => {
    const directory = await temporaryDirectory('rapidraw-bun-randomized-gate-');
    const failingTest = join(directory, 'failure.test.ts');
    await Bun.write(
      failingTest,
      'import { expect, test } from "bun:test";\ntest("intentional failure", () => expect(1).toBe(2));\n',
    );
    const runner = resolve('scripts/ci/run-bun-randomized-tests.ts');
    const result = await captured(['bun', runner, '--target', failingTest], {
      cwd: process.cwd(),
      env: { RAWENGINE_BUN_TEST_SEED: '314159' },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('Bun randomized isolation seed: 314159');
    expect(result.output).toContain('Reproduce: RAWENGINE_BUN_TEST_SEED=314159 bun run test:randomized');
  });

  test('summarizes LCOV function and line totals', () => {
    const summary = summarizeLcov(['TN:', 'SF:src/a.ts', 'FNF:2', 'FNH:1', 'LF:4', 'LH:3', 'end_of_record'].join('\n'));
    expect(summary).toEqual({ functions: { found: 2, hit: 1 }, lines: { found: 4, hit: 3 } });
    expect(() => enforceCoverageFloors(summary)).toThrow('Bun coverage floor failed');
    expect(BUN_COVERAGE_FLOORS).toEqual({ functions: 0.69, lines: 0.66 });
  });
});
