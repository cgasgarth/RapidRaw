#!/usr/bin/env bun

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface MainCommandContext {
  eventName: string | undefined;
  ref: string | undefined;
  runSha: string | undefined;
}

interface SupervisedChild {
  exitCode: number | null;
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
  pid: number;
}

export interface MainCommandReceipt {
  command: readonly string[];
  contractId: 'rapidraw.main-command-supersession.v1';
  endedAt: string;
  eventName: string | null;
  exitCode: number;
  observedMainSha: string | null;
  ref: string | null;
  remoteCheckFailures: number;
  runSha: string | null;
  startedAt: string;
  status: 'completed' | 'failed' | 'superseded';
}

interface RunMainCommandOptions {
  command: readonly string[];
  context: MainCommandContext;
  pollIntervalMs?: number;
  remoteCheckTimeoutMs?: number;
  readRemoteMainSha?: () => Promise<string | null>;
  spawnCommand?: (command: readonly string[]) => SupervisedChild;
  stopChild?: (child: SupervisedChild) => Promise<void>;
}

const DEFAULT_REMOTE_CHECK_TIMEOUT_MS = 10_000;

const environment = (name: string): string | undefined => {
  const value = Reflect.get(process.env, name);
  return typeof value === 'string' ? value : undefined;
};

export const shouldMonitorMain = ({ eventName, ref, runSha }: MainCommandContext): boolean =>
  eventName === 'push' && ref === 'refs/heads/main' && typeof runSha === 'string' && runSha.length > 0;

export const parseCommandArguments = (args: readonly string[]): string[] => {
  const separator = args.indexOf('--');
  return separator < 0 ? [...args] : args.slice(separator + 1);
};

async function waitForChildOrPoll(child: SupervisedChild, pollIntervalMs: number): Promise<'exited' | 'poll'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      child.exited.then(() => 'exited' as const),
      new Promise<'poll'>((resolvePoll) => {
        timer = setTimeout(() => resolvePoll('poll'), pollIntervalMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function readOriginMainSha(timeoutMs = DEFAULT_REMOTE_CHECK_TIMEOUT_MS): Promise<string | null> {
  const child = Bun.spawn(['git', 'ls-remote', '--exit-code', 'origin', 'refs/heads/main'], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if ((await waitForChildOrPoll(child, timeoutMs)) === 'poll') child.kill('SIGTERM');
  const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  if (exitCode !== 0) return null;
  const sha = stdout.trim().split(/\s+/u)[0];
  return typeof sha === 'string' && /^[a-f\d]{40}$/u.test(sha) ? sha : null;
}

const spawnCommand = (command: readonly string[]): SupervisedChild =>
  Bun.spawn([...command], { detached: true, stderr: 'inherit', stdout: 'inherit' });

async function readRemoteMainShaWithin(
  readRemoteMainSha: () => Promise<string | null>,
  timeoutMs: number,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readRemoteMainSha(),
      new Promise<null>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function stopProcessGroup(child: SupervisedChild): Promise<void> {
  if (child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) child.kill('SIGTERM');
  }
  const stopped = (await waitForChildOrPoll(child, 5_000)) === 'exited';
  if (stopped || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) child.kill('SIGKILL');
  }
  await child.exited;
}

export async function runLatestMainCommand({
  command,
  context,
  pollIntervalMs = 60_000,
  remoteCheckTimeoutMs = DEFAULT_REMOTE_CHECK_TIMEOUT_MS,
  readRemoteMainSha = readOriginMainSha,
  spawnCommand: startChild = spawnCommand,
  stopChild = stopProcessGroup,
}: RunMainCommandOptions): Promise<MainCommandReceipt> {
  if (command.length === 0) throw new Error('A command is required.');
  const startedAt = new Date().toISOString();
  const monitored = shouldMonitorMain(context);
  let observedMainSha: string | null = null;
  let remoteCheckFailures = 0;
  const checkCurrentMain = async (): Promise<boolean> => {
    if (!monitored) return false;
    let remoteSha: string | null;
    try {
      remoteSha = await readRemoteMainShaWithin(readRemoteMainSha, remoteCheckTimeoutMs);
    } catch {
      remoteCheckFailures += 1;
      return false;
    }
    if (remoteSha === null) {
      remoteCheckFailures += 1;
      return false;
    }
    observedMainSha = remoteSha;
    return remoteSha !== context.runSha;
  };

  if (await checkCurrentMain()) {
    return {
      command,
      contractId: 'rapidraw.main-command-supersession.v1',
      endedAt: new Date().toISOString(),
      eventName: context.eventName ?? null,
      exitCode: 0,
      observedMainSha,
      ref: context.ref ?? null,
      remoteCheckFailures,
      runSha: context.runSha ?? null,
      startedAt,
      status: 'superseded',
    };
  }

  const child = startChild(command);
  let superseded = false;
  while (child.exitCode === null) {
    const outcome = await waitForChildOrPoll(child, pollIntervalMs);
    if (outcome === 'exited') break;
    if (await checkCurrentMain()) {
      if (child.exitCode !== null) break;
      superseded = true;
      await stopChild(child);
      break;
    }
  }
  const exitCode = await child.exited;
  return {
    command,
    contractId: 'rapidraw.main-command-supersession.v1',
    endedAt: new Date().toISOString(),
    eventName: context.eventName ?? null,
    exitCode: superseded ? 0 : exitCode,
    observedMainSha,
    ref: context.ref ?? null,
    remoteCheckFailures,
    runSha: context.runSha ?? null,
    startedAt,
    status: superseded ? 'superseded' : exitCode === 0 ? 'completed' : 'failed',
  };
}

async function writeReceipt(receipt: MainCommandReceipt): Promise<void> {
  const receiptPath = resolve(
    environment('RAWENGINE_MAIN_COMMAND_RECEIPT') ?? 'artifacts/ci/main-command-supersession.json',
  );
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const summaryPath = environment('GITHUB_STEP_SUMMARY');
  if (summaryPath !== undefined) {
    const summary = `### Main command supersession\n- Status: \`${receipt.status}\`\n- Run SHA: \`${receipt.runSha ?? 'n/a'}\`\n- Observed main: \`${receipt.observedMainSha ?? 'unknown'}\`\n`;
    await appendFile(summaryPath, summary);
  }
  const outputPath = environment('GITHUB_OUTPUT');
  if (outputPath !== undefined) {
    await appendFile(outputPath, `run-command=${receipt.status === 'superseded' ? 'false' : 'true'}\n`);
  }
}

if (import.meta.main) {
  const command = parseCommandArguments(process.argv.slice(2));
  const receipt = await runLatestMainCommand({
    command,
    context: {
      eventName: environment('GITHUB_EVENT_NAME'),
      ref: environment('GITHUB_REF'),
      runSha: environment('GITHUB_SHA'),
    },
  });
  await writeReceipt(receipt);
  if (receipt.status === 'superseded') {
    console.log(`main command superseded (${receipt.runSha ?? 'unknown'} -> ${receipt.observedMainSha ?? 'unknown'})`);
  }
  process.exitCode = receipt.exitCode;
}
