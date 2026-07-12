import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'rapidraw-resource-coordinator-'));
  temporaryRoots.push(root);
  return root;
};

const coordinated = (root: string, label: string, script: string) =>
  Bun.spawn(
    [
      'bun',
      'scripts/ci/run-resource-coordinated.ts',
      '--resource',
      'native-heavy',
      '--label',
      label,
      '--',
      'bun',
      '-e',
      script,
    ],
    {
      env: {
        ...Bun.env,
        RAWENGINE_RESOURCE_COORDINATOR_ROOT: root,
        RAWENGINE_RESOURCE_WAIT_POLL_MS: '10',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    },
  );

describe('cross-worktree resource coordinator', () => {
  test('serializes heavy processes while an uncoordinated lightweight process still runs', async () => {
    const root = await temporaryRoot();
    const first = coordinated(
      root,
      'first-heavy',
      `console.log('first-start '+Date.now()); await Bun.sleep(350); console.log('first-end '+Date.now())`,
    );
    await Bun.sleep(60);
    const second = coordinated(root, 'second-heavy', `console.log('second-start '+Date.now())`);
    const lightweightStartedAt = Date.now();
    const lightweight = Bun.spawn(['bun', '-e', `await Bun.sleep(20)`]);
    expect(await lightweight.exited).toBe(0);
    expect(Date.now() - lightweightStartedAt).toBeLessThan(250);

    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    const firstOutput = await new Response(first.stdout).text();
    const secondOutput = await new Response(second.stdout).text();
    const firstEnd = Number(firstOutput.match(/first-end (\d+)/)?.[1]);
    const secondStart = Number(secondOutput.match(/second-start (\d+)/)?.[1]);
    expect(secondOutput).toContain('second-heavy waiting for native-heavy: first-heavy pid=');
    expect(secondStart).toBeGreaterThanOrEqual(firstEnd);
  });

  test('recovers a stale owner and reports its identity', async () => {
    const root = await temporaryRoot();
    const lockDirectory = join(root, 'native-heavy');
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      join(lockDirectory, 'owner.json'),
      `${JSON.stringify({
        hostname: (await import('node:os')).hostname(),
        label: 'interrupted-build',
        pid: 2_147_483_647,
        startedAt: '2026-01-01T00:00:00.000Z',
        worktree: '/tmp/old-worktree',
      })}\n`,
    );

    const successor = coordinated(root, 'successor', `console.log('successor-ran')`);
    expect(await successor.exited).toBe(0);
    const output = await new Response(successor.stdout).text();
    expect(output).toContain('successor recovered stale native-heavy: interrupted-build pid=2147483647');
    expect(output).toContain('successor-ran');
  });
});
