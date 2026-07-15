import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GitBranchUpdater,
  type GitHubOperations,
  type PullRequestIdentity,
  type ReadyPrUpdatePort,
  updateReadyPullRequests,
} from '../../../scripts/ci/update-ready-pr-branches';
import { isolatedGitEnvironment } from '../../../scripts/lib/ci/git-environment';

const REPOSITORY = 'cgasgarth/RapidRaw';
const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const MERGED_SHA = 'c'.repeat(40);

const candidate = (overrides: Partial<PullRequestIdentity> = {}): PullRequestIdentity => ({
  baseRef: 'main',
  baseSha: BASE_SHA,
  draft: false,
  headRef: 'codex/feature',
  headRepository: REPOSITORY,
  headSha: HEAD_SHA,
  number: 17,
  state: 'open',
  ...overrides,
});

const git = (cwd: string, args: readonly string[], environment = isolatedGitEnvironment(process.env)): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

class FakePort implements ReadyPrUpdatePort {
  active = false;
  behind = 1;
  current = candidate();
  dispatches: Array<{ expectedHeadSha: string; pr: PullRequestIdentity }> = [];
  mergeDisposition: 'updated' | 'changed' | 'conflict' | 'failed' = 'updated';
  merges: PullRequestIdentity[] = [];
  open = [candidate()];
  reads = 0;

  async listOpenPullRequests(): Promise<PullRequestIdentity[]> {
    return this.open;
  }

  async behindBy(): Promise<number> {
    return this.behind;
  }

  async hasActiveChecks(): Promise<boolean> {
    return this.active;
  }

  async readPullRequest(): Promise<PullRequestIdentity> {
    this.reads += 1;
    return this.reads > 1 && this.mergeDisposition === 'updated'
      ? { ...this.current, headSha: MERGED_SHA }
      : this.current;
  }

  async mergeAndPush(pr: PullRequestIdentity) {
    this.merges.push(pr);
    return this.mergeDisposition === 'updated'
      ? ({ disposition: 'updated', headSha: MERGED_SHA } as const)
      : ({ disposition: this.mergeDisposition } as const);
  }

  async dispatchRequiredChecks(pr: PullRequestIdentity, expectedHeadSha: string): Promise<void> {
    this.dispatches.push({ expectedHeadSha, pr });
  }
}

describe('ready PR branch freshness', () => {
  test('merges a stable same-repository head once and dispatches required checks for the pushed head', async () => {
    const port = new FakePort();

    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition: 'updated', number: 17 }]);
    expect(port.merges).toEqual([candidate()]);
    expect(port.dispatches).toEqual([{ expectedHeadSha: MERGED_SHA, pr: { ...candidate(), headSha: MERGED_SHA } }]);
  });

  test.each([
    ['current', (port: FakePort) => (port.behind = 0)],
    ['draft', (port: FakePort) => (port.open = [candidate({ draft: true })])],
    ['fork', (port: FakePort) => (port.open = [candidate({ headRepository: 'other/fork' })])],
    ['active', (port: FakePort) => (port.active = true)],
  ] as const)('skips a %s head without merging or dispatching', async (disposition, arrange) => {
    const port = new FakePort();
    arrange(port);

    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition, number: 17 }]);
    expect(port.merges).toHaveLength(0);
    expect(port.dispatches).toHaveLength(0);
  });

  test('skips a head that changes between selection and update', async () => {
    const port = new FakePort();
    port.current = candidate({ headSha: 'd'.repeat(40) });

    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition: 'changed', number: 17 }]);
    expect(port.merges).toHaveLength(0);
    expect(port.dispatches).toHaveLength(0);
  });

  test('skips when current-head checks start during selection', async () => {
    const port = new FakePort();
    let reads = 0;
    port.hasActiveChecks = async () => {
      reads += 1;
      return reads > 1;
    };

    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition: 'active', number: 17 }]);
    expect(port.merges).toHaveLength(0);
    expect(port.dispatches).toHaveLength(0);
  });

  test('updates on a later pass after current-head checks finish', async () => {
    const port = new FakePort();
    port.active = true;
    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition: 'active', number: 17 }]);

    port.active = false;
    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition: 'updated', number: 17 }]);
    expect(port.dispatches).toEqual([{ expectedHeadSha: MERGED_SHA, pr: { ...candidate(), headSha: MERGED_SHA } }]);

    port.behind = 0;
    port.open = [candidate({ headSha: MERGED_SHA })];
    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition: 'current', number: 17 }]);
    expect(port.dispatches).toHaveLength(1);
  });

  test('does not update a pull request that closes during selection', async () => {
    const port = new FakePort();
    port.current = candidate({ state: 'closed' });

    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition: 'changed', number: 17 }]);
    expect(port.merges).toHaveLength(0);
    expect(port.dispatches).toHaveLength(0);
  });

  test.each([
    'changed',
    'conflict',
    'failed',
  ] as const)('does not dispatch checks when the non-force merge result is %s', async (disposition) => {
    const port = new FakePort();
    port.mergeDisposition = disposition;

    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition, number: 17 }]);
    expect(port.merges).toEqual([candidate()]);
    expect(port.dispatches).toHaveLength(0);
  });

  test('does not dispatch against a head that advances after the merge push', async () => {
    const port = new FakePort();
    port.readPullRequest = async () => {
      port.reads += 1;
      return port.reads === 1 ? candidate() : candidate({ headSha: 'e'.repeat(40) });
    };

    expect(await updateReadyPullRequests(REPOSITORY, port)).toEqual([{ disposition: 'changed', number: 17 }]);
    expect(port.dispatches).toHaveLength(0);
  });

  test('pushes a normal two-parent merge that retains both branch histories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rapidraw-ready-pr-test-'));
    const parent = join(root, 'parent');
    const remote = join(root, 'remote.git');
    const repository = join(root, 'repository');
    mkdirSync(parent);
    mkdirSync(repository);
    try {
      git(parent, ['init']);
      git(parent, ['config', 'user.name', 'Parent User']);
      git(parent, ['config', 'user.email', 'parent@example.com']);
      writeFileSync(join(parent, 'parent.txt'), 'parent\n');
      git(parent, ['add', 'parent.txt']);
      const parentConfig = join(parent, '.git/config');
      const parentIndex = join(parent, '.git/index');
      const parentConfigBefore = readFileSync(parentConfig);
      const parentIndexBefore = readFileSync(parentIndex);
      const hookEnvironment = {
        ...process.env,
        GIT_DIR: join(parent, '.git'),
        GIT_INDEX_FILE: parentIndex,
        GIT_WORK_TREE: parent,
      };
      const fixtureEnvironment = isolatedGitEnvironment(hookEnvironment);
      expect(fixtureEnvironment).toMatchObject({ GIT_CONFIG_NOSYSTEM: '1' });
      expect(fixtureEnvironment.GIT_CONFIG_GLOBAL).toBeDefined();
      expect(fixtureEnvironment.GIT_DIR).toBeUndefined();
      expect(fixtureEnvironment.GIT_INDEX_FILE).toBeUndefined();
      expect(fixtureEnvironment.GIT_WORK_TREE).toBeUndefined();

      git(root, ['init', '--bare', remote], fixtureEnvironment);
      git(repository, ['init'], fixtureEnvironment);
      git(repository, ['config', 'user.name', 'Test User'], fixtureEnvironment);
      git(repository, ['config', 'user.email', 'test@example.com'], fixtureEnvironment);
      writeFileSync(join(repository, 'base.txt'), 'base\n');
      git(repository, ['add', 'base.txt'], fixtureEnvironment);
      git(repository, ['commit', '-m', 'base'], fixtureEnvironment);
      git(repository, ['branch', '-M', 'main'], fixtureEnvironment);
      git(repository, ['remote', 'add', 'origin', remote], fixtureEnvironment);
      git(repository, ['push', '-u', 'origin', 'main'], fixtureEnvironment);

      git(repository, ['checkout', '-b', 'codex/feature'], fixtureEnvironment);
      writeFileSync(join(repository, 'feature.txt'), 'feature\n');
      git(repository, ['add', 'feature.txt'], fixtureEnvironment);
      git(repository, ['commit', '-m', 'feature'], fixtureEnvironment);
      const featureSha = git(repository, ['rev-parse', 'HEAD'], fixtureEnvironment);
      git(repository, ['push', '-u', 'origin', 'codex/feature'], fixtureEnvironment);

      git(repository, ['checkout', 'main'], fixtureEnvironment);
      writeFileSync(join(repository, 'base.txt'), 'base updated\n');
      git(repository, ['commit', '-am', 'advance main'], fixtureEnvironment);
      const baseSha = git(repository, ['rev-parse', 'HEAD'], fixtureEnvironment);
      git(repository, ['push', 'origin', 'main'], fixtureEnvironment);
      git(repository, ['config', 'core.hooksPath', '.git/hooks'], fixtureEnvironment);
      for (const hook of ['pre-merge-commit', 'pre-push']) {
        writeFileSync(join(repository, '.git/hooks', hook), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      }

      const pr = candidate({ baseSha, headSha: featureSha });
      const unused = async (): Promise<never> => {
        throw new Error('unexpected API call');
      };
      const api: GitHubOperations = {
        behindBy: unused,
        dispatchRequiredChecks: unused,
        hasActiveChecks: unused,
        listOpenPullRequests: unused,
        readPullRequest: unused,
      };
      const result = await new GitBranchUpdater(api, repository, fixtureEnvironment).mergeAndPush(pr);
      expect(result.disposition).toBe('updated');
      if (result.disposition !== 'updated') throw new Error('expected updated branch');

      const remoteHead = git(repository, ['ls-remote', 'origin', 'refs/heads/codex/feature'], fixtureEnvironment).split(
        /\s+/u,
      )[0];
      expect(remoteHead).toBe(result.headSha);
      git(repository, ['fetch', 'origin', 'codex/feature'], fixtureEnvironment);
      expect(git(repository, ['merge-base', '--is-ancestor', featureSha, remoteHead], fixtureEnvironment)).toBe('');
      expect(git(repository, ['merge-base', '--is-ancestor', baseSha, remoteHead], fixtureEnvironment)).toBe('');
      expect(
        git(repository, ['rev-list', '--parents', '-n', '1', remoteHead], fixtureEnvironment).split(/\s+/u),
      ).toHaveLength(3);
      expect(readFileSync(parentConfig)).toEqual(parentConfigBefore);
      expect(readFileSync(parentIndex)).toEqual(parentIndexBefore);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
