import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BUN_COVERAGE_FLOORS, enforceCoverageFloors, summarizeLcov } from '../../../scripts/ci/check-bun-coverage.ts';
import { buildBunCoverageCommand } from '../../../scripts/ci/run-bun-coverage.ts';
import {
  buildRandomizedTestArgs,
  DEFAULT_RANDOMIZED_PASS_TIMEOUT_MS,
  RANDOMIZED_SUITE_RUN_COUNT,
  randomizedTestReproduction,
  resolveRandomizedPassTimeout,
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

async function processIsExecuting(pid: number): Promise<boolean> {
  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
    } catch {
      return false;
    }
  }
  const ps = Bun.spawnSync(['ps', '-o', 'state=', '-p', String(pid)]);
  if (ps.exitCode !== 0) return false;
  const state = ps.stdout.toString().trim();
  return state !== '' && !state.startsWith('Z');
}

async function captured(command: string[], options: { cwd: string; env?: Record<string, string>; timeoutMs?: number }) {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  let timedOut = false;
  const timeout =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, options.timeoutMs);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  return { exitCode, output: `${stdout}\n${stderr}`, timedOut };
}

describe('Bun native confidence gates', () => {
  test('uses native parallel randomization with a stable exact reproduction command', () => {
    const seed = resolveRandomizedTestSeed('424242');
    expect(seed).toBe(424242);
    expect(resolveRandomizedTestSeed('github-run-42')).toBe(resolveRandomizedTestSeed('github-run-42'));
    expect(buildRandomizedTestArgs(seed)).toEqual([
      'test',
      '--no-orphans',
      '--dots',
      '--parallel',
      '--bail=1',
      '--randomize',
      '--seed=424242',
      'tests/pure-ts',
    ]);
    expect(RANDOMIZED_SUITE_RUN_COUNT).toBe(2);
    expect(resolveRandomizedPassTimeout(undefined)).toBe(DEFAULT_RANDOMIZED_PASS_TIMEOUT_MS);
    expect(resolveRandomizedPassTimeout('750')).toBe(750);
    expect(randomizedTestReproduction(seed)).toBe('RAWENGINE_BUN_TEST_SEED=424242 bun run test:randomized');
    expect(buildBunCoverageCommand()).toEqual([
      'bun',
      'test',
      '--no-orphans',
      '--dots',
      '--parallel',
      '--coverage',
      'tests/pure-ts',
    ]);
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

  test('shared DOM preload closes isolated windows and their pending timers under native coverage', async () => {
    const directory = await temporaryDirectory('rapidraw-bun-dom-teardown-');
    const fixture =
      'import { expect, test } from "bun:test";\ntest("owns a DOM window", () => { expect(document.body).toBeDefined(); window.setTimeout(() => {}, 60_000); });\n';
    await Promise.all([
      Bun.write(join(directory, 'first.test.ts'), fixture),
      Bun.write(join(directory, 'second.test.ts'), fixture),
    ]);
    const setup = resolve('tests/setup/bun-dom.ts');
    const result = await captured(
      [
        'bun',
        'test',
        '--preload',
        setup,
        '--no-orphans',
        '--only-failures',
        '--parallel',
        '--coverage',
        './first.test.ts',
        './second.test.ts',
      ],
      { cwd: directory, timeoutMs: 5_000 },
    );
    expect(result.timedOut, result.output).toBeFalse();
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain('2 pass');
  });

  test('prints reproduction and exits bounded while killing a failed worker descendant', async () => {
    const directory = await temporaryDirectory('rapidraw-bun-randomized-gate-');
    const pidFile = join(directory, 'descendant-pid');
    const failingTest = join(directory, 'failure.test.ts');
    await Bun.write(
      failingTest,
      `import { expect, test } from "bun:test";\ntest("fails with a live descendant", async () => { const child = Bun.spawn(["bun", "-e", "await Bun.sleep(60_000)"], { stderr: "ignore", stdout: "ignore" }); await Bun.write(${JSON.stringify(pidFile)}, String(child.pid)); expect(1).toBe(2); }, 3_000);\n`,
    );
    const runner = resolve('scripts/ci/run-bun-randomized-tests.ts');
    const startedAt = performance.now();
    const result = await captured(['bun', runner, '--target', directory], {
      cwd: process.cwd(),
      env: { RAWENGINE_BUN_TEST_SEED: '314159', RAWENGINE_BUN_TEST_TIMEOUT_MS: '5000' },
      timeoutMs: 12_000,
    });
    expect(result.timedOut, result.output).toBeFalse();
    expect(result.exitCode).not.toBe(0);
    expect(performance.now() - startedAt).toBeLessThan(12_000);
    expect(result.output).toContain('Bun randomized isolation seed: 314159');
    expect(result.output).toContain('Reproduce: RAWENGINE_BUN_TEST_SEED=314159 bun run test:randomized');
    const descendantPid = Number(await Bun.file(pidFile).text());
    let descendantExecuting = await processIsExecuting(descendantPid);
    for (let attempt = 0; attempt < 100 && descendantExecuting; attempt += 1) {
      await Bun.sleep(10);
      descendantExecuting = await processIsExecuting(descendantPid);
    }
    expect(descendantExecuting).toBeFalse();
  }, 15_000);

  test('clears the pass watchdog after a successful native run', async () => {
    const directory = await temporaryDirectory('rapidraw-bun-randomized-success-');
    await Bun.write(
      join(directory, 'success.test.ts'),
      'import { expect, test } from "bun:test";\ntest("passes", () => expect(true).toBeTrue());\n',
    );
    const runner = resolve('scripts/ci/run-bun-randomized-tests.ts');
    const result = await captured(['bun', runner, '--target', directory], {
      cwd: process.cwd(),
      env: { RAWENGINE_BUN_TEST_SEED: '271828' },
      timeoutMs: 5_000,
    });
    expect(result.timedOut, result.output).toBeFalse();
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output.match(/1 pass/gu)).toHaveLength(RANDOMIZED_SUITE_RUN_COUNT);
  }, 8_000);

  test('summarizes LCOV function and line totals', () => {
    const summary = summarizeLcov(['TN:', 'SF:src/a.ts', 'FNF:2', 'FNH:1', 'LF:4', 'LH:3', 'end_of_record'].join('\n'));
    expect(summary).toEqual({ functions: { found: 2, hit: 1 }, lines: { found: 4, hit: 3 } });
    expect(() => enforceCoverageFloors(summary)).toThrow('Bun coverage floor failed');
    expect(BUN_COVERAGE_FLOORS).toEqual({ functions: 0.69, lines: 0.66 });
  });
});
