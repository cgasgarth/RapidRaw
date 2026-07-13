#!/usr/bin/env bun

import { watch } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { buildWatchRunArgs, watchedScenarioIds } from './watch-plan';

const root = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel']).stdout.toString().trim();
const forwarded = process.argv.slice(2);
const pendingPaths = new Set<string>();
let child: ReturnType<typeof Bun.spawn> | undefined;
let rerunPending = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let stopping = false;
const HMR_SETTLE_MS = 1_000;

const run = async (scenarioIds?: readonly string[]): Promise<void> => {
  if (child !== undefined) {
    rerunPending = true;
    return;
  }
  const args = buildWatchRunArgs(forwarded, scenarioIds);
  console.log(`qa watch run ${scenarioIds?.join(',') ?? 'initial selection'}`);
  child = Bun.spawn(['bun', 'scripts/qa/run.ts', ...args], { cwd: root, stderr: 'inherit', stdout: 'inherit' });
  const exitCode = await child.exited;
  child = undefined;
  console.log(`qa watch result exit=${exitCode}`);
  if (rerunPending && !stopping) {
    rerunPending = false;
    const paths = [...pendingPaths];
    pendingPaths.clear();
    const ids = watchedScenarioIds(paths);
    if (ids.length > 0) await run(ids);
  }
};

const schedule = (path: string): void => {
  pendingPaths.add(path);
  if (debounce !== undefined) clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (child !== undefined) {
      rerunPending = true;
      return;
    }
    const paths = [...pendingPaths];
    pendingPaths.clear();
    const ids = watchedScenarioIds(paths);
    if (ids.length > 0) void run(ids);
  }, HMR_SETTLE_MS);
};

const watchers = [];
for (const directory of ['src', 'src-tauri/src', 'scripts/qa', 'tests/integration']) {
  const absolute = resolve(root, directory);
  if (!(await lstat(absolute).catch(() => undefined))?.isDirectory()) continue;
  watchers.push(
    watch(absolute, { recursive: true }, (_event, filename) => {
      if (filename !== null) schedule(join(directory, String(filename)));
    }),
  );
}
watchers.push(
  watch(root, (_event, filename) => {
    if (filename !== null) schedule(relative(root, resolve(root, String(filename))));
  }),
);

const stop = (): void => {
  stopping = true;
  if (debounce !== undefined) clearTimeout(debounce);
  for (const watcher of watchers) watcher.close();
  child?.kill('SIGTERM');
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

await run();
while (!stopping) await Bun.sleep(1_000);
