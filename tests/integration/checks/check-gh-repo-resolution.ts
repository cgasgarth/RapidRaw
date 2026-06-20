#!/usr/bin/env bun

import { runQuiet, runText } from '../../../scripts/lib/process.ts';

const EXPECTED_REPOSITORY = 'cgasgarth/RapidRaw';
const EXPECTED_ORIGIN = 'https://github.com/cgasgarth/RapidRaw.git';
const EXPECTED_UPSTREAM = 'https://github.com/CyberTimon/RapidRAW.git';
const fixMode = process.argv.includes('--fix');

const readGitConfig = (key) => {
  try {
    return runText('git', ['config', '--get', key]);
  } catch {
    return '';
  }
};
const unsetAll = (key) => {
  try {
    runQuiet('git', ['config', '--unset-all', key]);
  } catch {
    // Missing config is already fixed.
  }
};

if (fixMode) {
  runQuiet('git', ['remote', 'set-url', 'origin', EXPECTED_ORIGIN]);
  runQuiet('git', ['remote', 'set-url', 'upstream', EXPECTED_UPSTREAM]);
  unsetAll('remote.origin.gh-resolved');
  runQuiet('git', ['config', 'remote.origin.gh-resolved', 'base']);
  unsetAll('remote.upstream.gh-resolved');
  runQuiet('git', ['config', 'remote.pushDefault', 'origin']);
  runQuiet('gh', ['repo', 'set-default', EXPECTED_REPOSITORY]);
}

const originUrl = readGitConfig('remote.origin.url');
const upstreamUrl = readGitConfig('remote.upstream.url');
const originGhResolved = readGitConfig('remote.origin.gh-resolved');
const upstreamGhResolved = readGitConfig('remote.upstream.gh-resolved');
const pushDefault = readGitConfig('remote.pushDefault');
let resolvedRepository = '';

try {
  resolvedRepository = runText('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
} catch (error) {
  console.error('gh repo resolution failed. Run `bun run repo:fix-gh-resolution` after `gh auth login`.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const failures = [];
if (originUrl !== EXPECTED_ORIGIN) failures.push(`origin url=${originUrl || '<missing>'}`);
if (upstreamUrl !== EXPECTED_UPSTREAM) failures.push(`upstream url=${upstreamUrl || '<missing>'}`);
if (originGhResolved !== 'base') failures.push(`origin gh-resolved=${originGhResolved || '<missing>'}`);
if (upstreamGhResolved !== '') failures.push(`upstream gh-resolved=${upstreamGhResolved}`);
if (pushDefault !== 'origin') failures.push(`pushDefault=${pushDefault || '<missing>'}`);
if (resolvedRepository !== EXPECTED_REPOSITORY) failures.push(`gh repo=${resolvedRepository || '<missing>'}`);

if (failures.length > 0) {
  console.error(`gh repo resolution failed: ${failures.join('; ')}`);
  console.error('Fix: bun run repo:fix-gh-resolution');
  process.exit(1);
}

console.log(`gh repo resolution ok (${EXPECTED_REPOSITORY})`);
