import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const seedStaleLock = async (root: string, label: string): Promise<void> => {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'native-heavy.lock'), '2147483647\n');
  await writeFile(
    join(root, 'native-heavy.owner.json'),
    `${JSON.stringify({
      hostname: (await import('node:os')).hostname(),
      label,
      pid: 2_147_483_647,
      startedAt: '2026-01-01T00:00:00.000Z',
      worktree: '/tmp/dead-worktree',
    })}\n`,
  );
};

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
    await seedStaleLock(root, 'interrupted-build');

    const successor = coordinated(root, 'successor', `console.log('successor-ran')`);
    expect(await successor.exited).toBe(0);
    const output = await new Response(successor.stdout).text();
    expect(output).toContain('successor recovered stale native-heavy: interrupted-build pid=2147483647');
    expect(output).toContain('successor-ran');
  });

  test('multiple stale waiters recover once without deleting the successor lease', async () => {
    const root = await temporaryRoot();
    await seedStaleLock(root, 'dead-owner');
    const first = coordinated(
      root,
      'first-successor',
      `console.log('first-start '+Date.now()); await Bun.sleep(120); console.log('first-end '+Date.now())`,
    );
    const second = coordinated(
      root,
      'second-successor',
      `console.log('second-start '+Date.now()); await Bun.sleep(120); console.log('second-end '+Date.now())`,
    );
    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    const outputs = [await new Response(first.stdout).text(), await new Response(second.stdout).text()];
    expect(outputs.some((output) => output.includes('recovered stale native-heavy'))).toBe(true);
    const intervals = outputs.map((output, index) => ({
      end: Number(output.match(new RegExp(`${index === 0 ? 'first' : 'second'}-end (\\d+)`))?.[1]),
      start: Number(output.match(new RegExp(`${index === 0 ? 'first' : 'second'}-start (\\d+)`))?.[1]),
    }));
    const firstInterval = intervals[0];
    const secondInterval = intervals[1];
    if (!firstInterval || !secondInterval) throw new Error('expected two successor intervals');
    expect(firstInterval.end <= secondInterval.start || secondInterval.end <= firstInterval.start).toBe(true);
  });

  test('a killed wrapper leaves its child process group as owner until the child exits', async () => {
    const root = await temporaryRoot();
    await seedStaleLock(root, 'killed-recoverer');
    const interrupted = coordinated(
      root,
      'interrupted-successor',
      `console.log('orphan-start '+Date.now()); await Bun.sleep(220); console.log('orphan-end '+Date.now())`,
    );
    let acquired = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const owner = await readFile(join(root, 'native-heavy.owner.json'), 'utf8').catch(() => '');
      if (owner.includes('interrupted-successor')) {
        acquired = true;
        break;
      }
      await Bun.sleep(10);
    }
    expect(acquired).toBe(true);
    interrupted.kill('SIGKILL');
    await interrupted.exited;
    const follower = coordinated(root, 'post-kill-follower', `console.log('follower-start '+Date.now())`);
    expect(await follower.exited).toBe(0);
    const orphanOutput = await new Response(interrupted.stdout).text();
    const followerOutput = await new Response(follower.stdout).text();
    const orphanEnd = Number(orphanOutput.match(/orphan-end (\d+)/)?.[1]);
    const followerStart = Number(followerOutput.match(/follower-start (\d+)/)?.[1]);
    expect(followerOutput).toContain('post-kill-follower waiting for native-heavy: interrupted-successor pid=');
    expect(followerStart).toBeGreaterThanOrEqual(orphanEnd);
  });
});
