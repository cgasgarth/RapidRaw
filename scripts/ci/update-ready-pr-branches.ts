#!/usr/bin/env bun

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const pullRequestSchema = z.object({
  base: z.object({
    ref: z.string().min(1),
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
  }),
  draft: z.boolean().nullable(),
  head: z.object({
    ref: z.string().min(1),
    repo: z.object({ full_name: z.string().min(1) }).nullable(),
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
  }),
  number: z.number().int().positive(),
  state: z.enum(['open', 'closed']),
});

const pullRequestListSchema = z.array(pullRequestSchema);
const comparisonSchema = z.object({ behind_by: z.number().int().nonnegative() });
const workflowRunsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      head_sha: z.string(),
      status: z.string(),
    }),
  ),
});

export interface PullRequestIdentity {
  baseRef: string;
  baseSha: string;
  draft: boolean;
  headRef: string;
  headRepository: string | null;
  headSha: string;
  number: number;
  state: 'open' | 'closed';
}

export type UpdateDisposition = 'updated' | 'current' | 'draft' | 'fork' | 'active' | 'changed' | 'conflict' | 'failed';

export interface UpdateResult {
  disposition: UpdateDisposition;
  number: number;
}

export interface ReadyPrUpdatePort {
  behindBy(pr: PullRequestIdentity): Promise<number>;
  dispatchRequiredChecks(pr: PullRequestIdentity, expectedHeadSha: string): Promise<void>;
  hasActiveChecks(headSha: string): Promise<boolean>;
  listOpenPullRequests(): Promise<PullRequestIdentity[]>;
  mergeAndPush(
    pr: PullRequestIdentity,
  ): Promise<{ disposition: 'updated'; headSha: string } | { disposition: 'changed' | 'conflict' | 'failed' }>;
  readPullRequest(number: number): Promise<PullRequestIdentity>;
}

const sameIdentity = (left: PullRequestIdentity, right: PullRequestIdentity): boolean =>
  left.number === right.number &&
  left.headSha === right.headSha &&
  left.headRef === right.headRef &&
  left.headRepository === right.headRepository &&
  left.baseSha === right.baseSha &&
  left.baseRef === right.baseRef &&
  !right.draft &&
  right.state === 'open';

export const updateReadyPullRequests = async (repository: string, port: ReadyPrUpdatePort): Promise<UpdateResult[]> => {
  const results: UpdateResult[] = [];
  for (const candidate of await port.listOpenPullRequests()) {
    if (candidate.draft) {
      results.push({ disposition: 'draft', number: candidate.number });
      continue;
    }
    if (candidate.headRepository !== repository) {
      results.push({ disposition: 'fork', number: candidate.number });
      continue;
    }
    if ((await port.behindBy(candidate)) === 0) {
      results.push({ disposition: 'current', number: candidate.number });
      continue;
    }
    if (await port.hasActiveChecks(candidate.headSha)) {
      results.push({ disposition: 'active', number: candidate.number });
      continue;
    }

    const current = await port.readPullRequest(candidate.number);
    if (!sameIdentity(candidate, current)) {
      results.push({ disposition: 'changed', number: candidate.number });
      continue;
    }
    if (await port.hasActiveChecks(current.headSha)) {
      results.push({ disposition: 'active', number: candidate.number });
      continue;
    }

    const merged = await port.mergeAndPush(current);
    if (merged.disposition !== 'updated') {
      results.push({ disposition: merged.disposition, number: candidate.number });
      continue;
    }

    const pushed = await port.readPullRequest(candidate.number);
    if (
      pushed.headSha !== merged.headSha ||
      pushed.headRef !== current.headRef ||
      pushed.headRepository !== repository ||
      pushed.baseSha !== current.baseSha ||
      pushed.draft ||
      pushed.state !== 'open'
    ) {
      results.push({ disposition: 'changed', number: candidate.number });
      continue;
    }

    await port.dispatchRequiredChecks(pushed, merged.headSha);
    results.push({ disposition: 'updated', number: candidate.number });
  }
  return results;
};

const toIdentity = (value: z.infer<typeof pullRequestSchema>): PullRequestIdentity => ({
  baseRef: value.base.ref,
  baseSha: value.base.sha,
  draft: value.draft ?? false,
  headRef: value.head.ref,
  headRepository: value.head.repo?.full_name ?? null,
  headSha: value.head.sha,
  number: value.number,
  state: value.state,
});

interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type GitCommandEnvironment = Readonly<Record<string, string | undefined>>;

const runCommand = async (
  command: string,
  args: readonly string[],
  cwd = process.cwd(),
  environment: GitCommandEnvironment = process.env,
): Promise<CommandResult> => {
  const child = Bun.spawn([command, ...args], { cwd, env: environment, stderr: 'pipe', stdout: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr: stderr.trim(), stdout: stdout.trim() };
};

const requireSuccess = (result: CommandResult, description: string): string => {
  if (result.exitCode !== 0) {
    throw new Error(`${description}: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
  }
  return result.stdout;
};

const ACTIVE_RUN_STATUSES = new Set(['in_progress', 'pending', 'queued', 'requested', 'waiting']);

export interface GitHubOperations {
  behindBy(pr: PullRequestIdentity): Promise<number>;
  dispatchRequiredChecks(pr: PullRequestIdentity, expectedHeadSha: string): Promise<void>;
  hasActiveChecks(headSha: string): Promise<boolean>;
  listOpenPullRequests(): Promise<PullRequestIdentity[]>;
  readPullRequest(number: number): Promise<PullRequestIdentity>;
}

class GitHubApi implements GitHubOperations {
  constructor(
    private readonly repository: string,
    private readonly token: string,
  ) {}

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`https://api.github.com/repos/${this.repository}/${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...init?.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} ${path}: ${(await response.text()).slice(0, 500)}`);
    }
    if (response.status === 204) return undefined;
    return response.json();
  }

  async listOpenPullRequests(): Promise<PullRequestIdentity[]> {
    const result: PullRequestIdentity[] = [];
    for (let page = 1; ; page += 1) {
      const values = pullRequestListSchema.parse(
        await this.request(`pulls?state=open&base=main&per_page=100&page=${page}`),
      );
      result.push(...values.map(toIdentity));
      if (values.length < 100) return result;
    }
  }

  async readPullRequest(number: number): Promise<PullRequestIdentity> {
    return toIdentity(pullRequestSchema.parse(await this.request(`pulls/${number}`)));
  }

  async behindBy(pr: PullRequestIdentity): Promise<number> {
    const base = encodeURIComponent(pr.baseSha);
    const head = encodeURIComponent(pr.headSha);
    return comparisonSchema.parse(await this.request(`compare/${base}...${head}`)).behind_by;
  }

  async hasActiveChecks(headSha: string): Promise<boolean> {
    const runs = workflowRunsSchema.parse(
      await this.request(`actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=100`),
    ).workflow_runs;
    return runs.some((run) => run.head_sha === headSha && ACTIVE_RUN_STATUSES.has(run.status));
  }

  async dispatchRequiredChecks(pr: PullRequestIdentity, expectedHeadSha: string): Promise<void> {
    await this.request('actions/workflows/lint.yml/dispatches', {
      body: JSON.stringify({
        inputs: {
          base_sha: pr.baseSha,
          expected_head_sha: expectedHeadSha,
          pull_request_number: String(pr.number),
        },
        ref: pr.headRef,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  }
}

export class GitBranchUpdater implements ReadyPrUpdatePort {
  constructor(
    private readonly api: GitHubOperations,
    private readonly repositoryRoot = process.cwd(),
    private readonly gitEnvironment: GitCommandEnvironment = process.env,
  ) {}

  listOpenPullRequests(): Promise<PullRequestIdentity[]> {
    return this.api.listOpenPullRequests();
  }

  readPullRequest(number: number): Promise<PullRequestIdentity> {
    return this.api.readPullRequest(number);
  }

  behindBy(pr: PullRequestIdentity): Promise<number> {
    return this.api.behindBy(pr);
  }

  hasActiveChecks(headSha: string): Promise<boolean> {
    return this.api.hasActiveChecks(headSha);
  }

  dispatchRequiredChecks(pr: PullRequestIdentity, expectedHeadSha: string): Promise<void> {
    return this.api.dispatchRequiredChecks(pr, expectedHeadSha);
  }

  async mergeAndPush(
    pr: PullRequestIdentity,
  ): Promise<{ disposition: 'updated'; headSha: string } | { disposition: 'changed' | 'conflict' | 'failed' }> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'rapidraw-ready-pr-'));
    const worktree = join(temporaryRoot, 'worktree');
    let worktreeAdded = false;
    try {
      for (const ref of [pr.baseRef, pr.headRef]) {
        requireSuccess(
          await runCommand('git', ['check-ref-format', '--branch', ref], this.repositoryRoot, this.gitEnvironment),
          `invalid branch ${ref}`,
        );
      }
      const fetch = await runCommand(
        'git',
        [
          'fetch',
          '--no-tags',
          'origin',
          `+refs/heads/${pr.baseRef}:refs/remotes/origin/${pr.baseRef}`,
          `+refs/heads/${pr.headRef}:refs/remotes/origin/${pr.headRef}`,
        ],
        this.repositoryRoot,
        this.gitEnvironment,
      );
      requireSuccess(fetch, `fetch PR #${pr.number}`);
      const fetchedBase = requireSuccess(
        await runCommand(
          'git',
          ['rev-parse', `refs/remotes/origin/${pr.baseRef}`],
          this.repositoryRoot,
          this.gitEnvironment,
        ),
        `resolve base for PR #${pr.number}`,
      );
      const fetchedHead = requireSuccess(
        await runCommand(
          'git',
          ['rev-parse', `refs/remotes/origin/${pr.headRef}`],
          this.repositoryRoot,
          this.gitEnvironment,
        ),
        `resolve head for PR #${pr.number}`,
      );
      if (fetchedBase !== pr.baseSha || fetchedHead !== pr.headSha) {
        console.log(`PR #${pr.number}: base or head changed while fetching.`);
        return { disposition: 'changed' };
      }

      requireSuccess(
        await runCommand(
          'git',
          ['worktree', 'add', '--detach', worktree, pr.headSha],
          this.repositoryRoot,
          this.gitEnvironment,
        ),
        'add worktree',
      );
      worktreeAdded = true;
      const merge = await runCommand(
        'git',
        [
          '-c',
          'user.name=github-actions[bot]',
          '-c',
          'user.email=41898282+github-actions[bot]@users.noreply.github.com',
          '-c',
          'core.hooksPath=/dev/null',
          'merge',
          '--no-edit',
          pr.baseSha,
        ],
        worktree,
        this.gitEnvironment,
      );
      if (merge.exitCode !== 0) return { disposition: 'conflict' };
      const mergedSha = requireSuccess(
        await runCommand('git', ['rev-parse', 'HEAD'], worktree, this.gitEnvironment),
        'resolve merge head',
      );
      if (mergedSha === pr.headSha) {
        console.log(`PR #${pr.number}: head became current before merge.`);
        return { disposition: 'changed' };
      }

      const remoteHead = requireSuccess(
        await runCommand(
          'git',
          ['ls-remote', 'origin', `refs/heads/${pr.headRef}`],
          this.repositoryRoot,
          this.gitEnvironment,
        ),
        `recheck PR #${pr.number}`,
      ).split(/\s+/u)[0];
      if (remoteHead !== pr.headSha) {
        console.log(`PR #${pr.number}: head changed before push.`);
        return { disposition: 'changed' };
      }

      const push = await runCommand(
        'git',
        ['-c', 'core.hooksPath=/dev/null', 'push', 'origin', `HEAD:refs/heads/${pr.headRef}`],
        worktree,
        this.gitEnvironment,
      );
      if (push.exitCode !== 0) {
        const latest = await this.api.readPullRequest(pr.number);
        return { disposition: latest.headSha === pr.headSha ? 'failed' : 'changed' };
      }
      return { disposition: 'updated', headSha: mergedSha };
    } catch (error) {
      console.error(`PR #${pr.number}: ${error instanceof Error ? error.message : String(error)}`);
      return { disposition: 'failed' };
    } finally {
      if (worktreeAdded) {
        await runCommand('git', ['worktree', 'remove', '--force', worktree], this.repositoryRoot, this.gitEnvironment);
      }
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }
}

const writeSummary = async (results: readonly UpdateResult[]): Promise<void> => {
  const counts = new Map<UpdateDisposition, number>();
  for (const result of results) counts.set(result.disposition, (counts.get(result.disposition) ?? 0) + 1);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const lines = [...counts.entries()].map(([key, value]) => `- ${key}: ${value}`).join('\n');
    await Bun.write(summary, `## Ready PR freshness\n\n${lines || '- no open PRs'}\n`);
  }
  console.log(
    results.length === 0
      ? 'ready PR freshness ok (no open PRs)'
      : `ready PR freshness: ${[...counts.entries()].map(([key, value]) => `${key}=${value}`).join(' ')}`,
  );
};

if (import.meta.main) {
  const repository = z
    .string()
    .regex(/^[^/]+\/[^/]+$/u)
    .parse(process.env.GITHUB_REPOSITORY);
  const token = z.string().min(1).parse(process.env.GITHUB_TOKEN);
  const api = new GitHubApi(repository, token);
  const gitEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[0] !== 'GITHUB_TOKEN' && entry[1] !== undefined,
    ),
  );
  const results = await updateReadyPullRequests(repository, new GitBranchUpdater(api, process.cwd(), gitEnvironment));
  await writeSummary(results);
  if (results.some((result) => result.disposition === 'failed')) process.exit(1);
}
