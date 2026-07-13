import { selectImpactedScenarioIds } from './impacted';
import { qaScenarios } from './scenarios';

const watchedRoots = ['src/', 'src-tauri/src/', 'scripts/qa/', 'tests/integration/'] as const;
const watchedFiles = new Set(['package.json', 'bun.lock', 'vite.config.js', 'vite.config.ts']);

export function isQaWatchSourcePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '');
  return watchedFiles.has(normalized) || watchedRoots.some((root) => normalized.startsWith(root));
}

export function watchedScenarioIds(paths: readonly string[]): string[] {
  const watched = [...new Set(paths.filter(isQaWatchSourcePath))].sort();
  return watched.length === 0 ? [] : selectImpactedScenarioIds(watched, qaScenarios);
}

export function withoutScenarioSelectors(args: readonly string[]): string[] {
  const retained: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--scenario' || args[index] === '--tag') {
      index += 1;
      continue;
    }
    retained.push(args[index] ?? '');
  }
  return retained;
}

export function buildWatchRunArgs(args: readonly string[], scenarioIds?: readonly string[]): string[] {
  const forwarded = args.filter((argument) => argument !== '--watch');
  const persistentOption = forwarded.includes('--persistent') ? [] : ['--persistent'];
  if (scenarioIds === undefined) return [...forwarded, ...persistentOption];
  return [
    ...withoutScenarioSelectors(forwarded),
    ...persistentOption,
    ...scenarioIds.flatMap((id) => ['--scenario', id]),
  ];
}
