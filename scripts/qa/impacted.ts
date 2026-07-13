import type { QaScenario } from './model';

const rules: readonly { pattern: RegExp; tags: readonly string[] }[] = [
  { pattern: /(?:Compare|compare)/u, tags: ['compare'] },
  { pattern: /(?:Crop|crop|Straighten|straighten)/u, tags: ['crop'] },
  { pattern: /(?:Negative|negative-lab)/u, tags: ['negative-lab'] },
  { pattern: /(?:CopyPaste|copy-paste|CopyPasteSettings)/u, tags: ['copy-paste'] },
  { pattern: /(?:Navigation|navigation|CommandPalette|command-palette)/u, tags: ['navigation'] },
  { pattern: /(?:\.css$|components\/ui\/|i18n)/u, tags: ['accessibility'] },
  {
    pattern:
      /(?:scripts\/qa\/|tests\/integration\/checks\/check-browser-tauri-harness|src\/validation\/browserTauriHarness)/u,
    tags: ['browser'],
  },
  { pattern: /(?:src-tauri|tauri|bun\.lock|package\.json|vite\.config)/u, tags: ['browser'] },
];

export function selectImpactedScenarioIds(paths: readonly string[], scenarios: readonly QaScenario[]): string[] {
  if (paths.length === 0) return [];
  const matchedRules = paths.map((path) => rules.filter(({ pattern }) => pattern.test(path.replaceAll('\\', '/'))));
  if (matchedRules.some((matches) => matches.length === 0)) return scenarios.map(({ id }) => id);
  const tags = new Set(matchedRules.flatMap((matches) => matches.flatMap(({ tags }) => tags)));
  return scenarios.filter((scenario) => scenario.tags.some((tag) => tags.has(tag))).map(({ id }) => id);
}
