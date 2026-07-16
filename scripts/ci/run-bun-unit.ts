#!/usr/bin/env bun

import { formatCommandForLog } from '../lib/ci/compact-output.ts';

const TEST_FILE_HEADER = /(?:^|\/)[^\s:]+\.test\.[cm]?[jt]sx?:$/u;
const FAILURE_ANCHOR = /^error:/u;
const FAILURE_LINE = /^\(fail\)/u;
const MAX_FAILURES = 3;
const CONTEXT_AFTER_FAILURE = 2;

export const selectBunFailureContext = (output: string): string => {
  const lines = output.split(/\r?\n/u);
  const errorIndices = lines.flatMap((line, index) => (FAILURE_ANCHOR.test(line) ? [index] : []));
  const anchors =
    errorIndices.length > 0 ? errorIndices : lines.flatMap((line, index) => (FAILURE_LINE.test(line) ? [index] : []));
  if (anchors.length === 0) return lines.slice(-24).join('\n').trim();

  const contexts = anchors.slice(0, MAX_FAILURES).map((anchor) => {
    const header = lines.slice(0, anchor).findLastIndex((line) => TEST_FILE_HEADER.test(line));
    const fail = lines.findIndex((line, index) => index >= anchor && FAILURE_LINE.test(line));
    const end =
      fail >= 0 ? Math.min(lines.length, fail + CONTEXT_AFTER_FAILURE + 1) : Math.min(lines.length, anchor + 16);
    let start = anchor;
    for (let index = anchor - 1; index > header; index -= 1) {
      const line = lines[index] ?? '';
      if (line === '' || /^\d+ \|/u.test(line) || /^\s*\^\s*$/u.test(line)) start = index;
      else break;
    }
    const selected = lines.slice(start, end);
    if (header >= 0) selected.unshift(lines[header] ?? '');
    return selected.join('\n').trim();
  });

  if (anchors.length > MAX_FAILURES) contexts.push(`[${String(anchors.length - MAX_FAILURES)} more failures omitted]`);
  return contexts.filter(Boolean).join('\n\n');
};

export const runBunUnit = async (targets: readonly string[] = ['tests/pure-ts']): Promise<number> => {
  const command: [string, ...string[]] = [
    'bun',
    'test',
    '--no-orphans',
    '--only-failures',
    '--parallel',
    '--parallel-delay=100',
    ...targets,
  ];
  const child = Bun.spawn(command, {
    env: { ...process.env, AGENT: '1' },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const output = `${stdout}\n${stderr}`;

  if (exitCode === 0) {
    const summary = output.match(/Ran (\d+) tests? across (\d+) files?\. \[([^\]]+)\]/u);
    console.log(summary ? `bun unit ok (${summary[1]} tests, ${summary[2]} files, ${summary[3]})` : 'bun unit ok');
    return 0;
  }

  console.error(`bun unit failed (exit=${String(exitCode)})`);
  console.error(`reproduce: ${formatCommandForLog(command[0], command.slice(1), { maxArgs: 20, maxChars: 500 })}`);
  const context = selectBunFailureContext(output);
  if (context) console.error(context);
  return exitCode;
};

if (import.meta.main) process.exit(await runBunUnit(process.argv.slice(2)));
