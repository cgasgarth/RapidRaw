import type { QaScenario } from './model';

const rules: readonly { pattern: RegExp; tags: readonly string[] }[] = [
  { pattern: /(?:Compare|compare)/u, tags: ['compare'] },
  { pattern: /(?:Crop|crop|Straighten|straighten)/u, tags: ['crop'] },
  { pattern: /(?:Negative|negative-lab)/u, tags: ['negative-lab'] },
  { pattern: /(?:\.css$|components\/ui\/|i18n)/u, tags: ['accessibility'] },
  { pattern: /(?:src-tauri|tauri|bun\.lock|package\.json|vite\.config)/u, tags: ['browser'] },
];

export function selectImpactedScenarioIds(paths: readonly string[], scenarios: readonly QaScenario[]): string[] {
  const tags = new Set(
    paths.flatMap((path) => rules.filter(({ pattern }) => pattern.test(path)).flatMap(({ tags }) => tags)),
  );
  if (paths.length === 0) return [];
  if (tags.size === 0) return scenarios.map(({ id }) => id);
  return scenarios.filter((scenario) => scenario.tags.some((tag) => tags.has(tag))).map(({ id }) => id);
}
