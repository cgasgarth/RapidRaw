import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildBunUnitCommand, selectBunFailureContext } from '../../../scripts/ci/run-bun-unit';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

test('selects the assertion and location instead of preceding worker noise', () => {
  const context = selectBunFailureContext(
    `fixture.test.ts:\n${'noise\n'.repeat(100)}2 | test('fails', () => {\n3 |   expect(1).toBe(2);\n               ^\nerror: expect(received).toBe(expected)\nExpected: 2\nReceived: 1\n    at fixture.test.ts:3:14\n(fail) fails\n`,
  );
  expect(context).toContain('fixture.test.ts:');
  expect(context).toContain('3 |   expect(1).toBe(2)');
  expect(context).toContain('at fixture.test.ts:3:14');
  expect(context).toContain('(fail) fails');
  expect(context).not.toContain('noise');
});

test('uses one bare Bun-native parallel command without staging or custom workers', () => {
  expect(buildBunUnitCommand()).toEqual([
    'bun',
    'test',
    '--no-orphans',
    '--only-failures',
    '--parallel',
    'tests/pure-ts',
  ]);
});

test('native parallel runner keeps an actionable failure through its compact boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rapidraw-bun-failure-output-'));
  temporaryRoots.push(root);
  const fixture = join(root, 'actionable.test.ts');
  await writeFile(
    fixture,
    `import { expect, test } from 'bun:test';
console.error('worker noise '.repeat(500));
test('preserves the actionable assertion', () => {
  expect({ actual: 1 }).toEqual({ actual: 2 });
});
`,
  );
  const runner = resolve(import.meta.dir, '../../../scripts/ci/run-bun-unit.ts');
  const child = Bun.spawn(['bun', runner, fixture], { stderr: 'pipe', stdout: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const output = `${stdout}\n${stderr}`;

  expect(exitCode).toBe(1);
  expect(output).toContain('bun unit failed (exit=1)');
  expect(output).toContain('reproduce: bun test --no-orphans --only-failures --parallel');
  expect(output).toContain('4 |   expect({ actual: 1 }).toEqual({ actual: 2 });');
  expect(output).toContain(`${fixture}:4:`);
  expect(output).toContain('(fail) preserves the actionable assertion');
  expect(output).not.toContain('worker noise worker noise');
  expect(output.length).toBeLessThan(4_000);
});
