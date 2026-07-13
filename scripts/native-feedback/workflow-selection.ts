import { writeFile } from 'node:fs/promises';

const leafCrates = ['rapidraw-ai', 'rapidraw-codecs', 'rapidraw-computational', 'rapidraw-types'] as const;

export interface NativeFeedbackWorkflowSelection {
  coreRequired: boolean;
  fullRequired: boolean;
  leafCrates: string[];
  reason: string;
}

export function selectNativeFeedbackWorkflow(paths: readonly string[]): NativeFeedbackWorkflowSelection {
  const changed = [...new Set(paths.map((path) => path.trim().replaceAll('\\', '/')).filter(Boolean))].sort();
  if (changed.length === 0)
    return { coreRequired: true, fullRequired: true, leafCrates: [], reason: 'empty change set; fail closed' };
  const leafCratesChanged = leafCrates.filter((crate) =>
    changed.some((path) => path.startsWith(`src-tauri/crates/${crate}/`)),
  );
  const nativePaths = changed.filter(
    (path) =>
      path.startsWith('src-tauri/') ||
      path.startsWith('.cargo/') ||
      ['Cargo.lock', 'Cargo.toml', 'rust-toolchain.toml', 'rustfmt.toml'].includes(path),
  );
  if (nativePaths.length === 0)
    return { coreRequired: false, fullRequired: true, leafCrates: [], reason: 'full PR closure only' };
  const coreRequired = nativePaths.some(
    (path) =>
      !path.startsWith('src-tauri/crates/') ||
      !leafCrates.some((crate) => path.startsWith(`src-tauri/crates/${crate}/`)),
  );
  return {
    coreRequired,
    fullRequired: true,
    leafCrates: [...leafCratesChanged],
    reason: coreRequired ? 'root/core native input changed' : 'workspace leaf input changed',
  };
}

if (import.meta.main) {
  const pathsFileIndex = process.argv.indexOf('--paths-file');
  const pathsFile = pathsFileIndex < 0 ? undefined : process.argv[pathsFileIndex + 1];
  const output = Bun.env.GITHUB_OUTPUT;
  if (pathsFile === undefined || output === undefined)
    throw new Error('Usage: GITHUB_OUTPUT=<path> bun workflow-selection.ts --paths-file <newline-paths>');
  const paths = (await Bun.file(pathsFile).text()).split('\n');
  const selection = selectNativeFeedbackWorkflow(paths);
  await writeFile(
    output,
    [
      `leaf_crates=${JSON.stringify(selection.leafCrates)}`,
      `core_required=${selection.coreRequired}`,
      `full_required=${selection.fullRequired}`,
      `reason=${selection.reason}`,
      '',
    ].join('\n'),
    { flag: 'a' },
  );
  console.log(
    `native feedback selection: leaves=${selection.leafCrates.join(',') || 'none'} core=${selection.coreRequired} full=${selection.fullRequired}`,
  );
}
