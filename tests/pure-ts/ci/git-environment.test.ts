import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isolatedGitEnvironment } from '../../../scripts/lib/ci/git-environment';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test('synthetic repositories cannot inherit a global fsmonitor process hook', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rapidraw-isolated-git-'));
  temporaryRoots.push(root);
  const home = join(root, 'home');
  const repository = join(root, 'repository');
  const marker = join(root, 'fsmonitor-invoked');
  const hook = join(root, 'fsmonitor-hook.sh');
  await Promise.all([mkdir(home), mkdir(repository)]);
  await Bun.write(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`);
  await chmod(hook, 0o755);
  await Bun.write(join(home, '.gitconfig'), `[core]\n\tfsmonitor = ${hook}\n`);
  await Bun.write(join(repository, '.keep'), 'fixture\n');

  const environment = isolatedGitEnvironment({ ...process.env, HOME: home });
  expect(Bun.spawnSync(['git', 'init', '--quiet'], { cwd: repository, env: environment }).exitCode).toBe(0);
  expect(Bun.spawnSync(['git', 'status', '--porcelain=v1'], { cwd: repository, env: environment }).exitCode).toBe(0);
  expect(await Bun.file(marker).exists()).toBeFalse();
});
