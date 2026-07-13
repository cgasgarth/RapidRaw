import type { InputClass } from './manifest';

const ownershipRules: readonly [RegExp, readonly InputClass[]][] = [
  [/^(docs\/|README|.*\.md$)/, ['docs']],
  [/^(src\/|tests\/pure-ts\/|vite\.config|index\.html)/, ['frontend']],
  [/^(packages\/rawengine-schema\/|src\/tauri\/|.*schema)/, ['schema']],
  [/^(src-tauri\/|Cargo\.|rust-toolchain)/, ['rust']],
  [/^\.github\/workflows\//, ['workflows']],
  [/(^|\/)(bun\.lock|package\.json|Cargo\.toml|Cargo\.lock|deny\.toml)$/, ['dependencies']],
  [/^(scripts\/|\.githooks\/|tests\/integration\/checks\/)/, ['scripts']],
];

// Ownership propagates through product/build dependencies, not filename similarity alone.
const classDependencies: Partial<Record<InputClass, readonly InputClass[]>> = {
  schema: ['frontend'],
  dependencies: ['frontend', 'rust'],
  workflows: ['scripts'],
};

export const classesForPath = (path: string): InputClass[] => {
  const direct = new Set<InputClass>();
  for (const [pattern, classes] of ownershipRules) {
    if (pattern.test(path)) for (const input of classes) direct.add(input);
  }
  if (direct.size === 0)
    for (const fallback of ['frontend', 'schema', 'rust', 'scripts'] as const) direct.add(fallback);
  const queue = [...direct];
  for (let index = 0; index < queue.length; index += 1) {
    for (const dependency of classDependencies[queue[index]] ?? []) {
      if (!direct.has(dependency)) {
        direct.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return [...direct];
};
