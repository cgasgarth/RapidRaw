#!/usr/bin/env bun
// @ts-check

import { readFileSync } from 'node:fs';

import { getExtension, toRepoPath, walkRepoFiles } from '../../../../scripts/lib/ci/repo-files.ts';
import { lineAtOffset, parseSource, visitSource } from '../../../../scripts/lib/ci/source-ast.ts';

const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx']);
const SCHEMA_WRAPPER_PATH = 'src/utils/tauriSchemaInvoke.ts';

const APPROVED_RAW_INVOKE_BUDGET = {
  'src/App.tsx': { raw: 2, typed: 0 },
  'src/components/adjustments/Effects.tsx': { raw: 2, typed: 0 },
  'src/components/modals/editing/CollageModal.tsx': { raw: 2, typed: 2 },
  'src/components/modals/editing/CullingModal.tsx': { raw: 1, typed: 0 },
  'src/components/modals/editing/LensCorrectionModal.tsx': { raw: 10, typed: 9 },
  'src/components/modals/negative-lab/NegativeConversionModal.tsx': { raw: 3, typed: 1 },
  'src/components/modals/editing/TransformModal.tsx': { raw: 2, typed: 0 },
  'src/components/panel/CommunityPage.tsx': { raw: 4, typed: 0 },
  'src/components/panel/Editor.tsx': { raw: 3, typed: 0 },
  'src/components/panel/SettingsPanel.tsx': { raw: 1, typed: 0 },
  'src/components/panel/right/export/ExportPanel.tsx': { raw: 3, typed: 0 },
  'src/components/panel/right/layers/MasksPanel.tsx': { raw: 1, typed: 1 },
  'src/components/panel/right/metadata/MetadataPanel.tsx': { raw: 2, typed: 0 },
  'src/components/panel/right/color/PresetsPanel.tsx': { raw: 2, typed: 0 },
  'src/components/ui/LUTControl.tsx': { raw: 1, typed: 1 },
  'src/context/TaggingSubMenu.tsx': { raw: 2, typed: 0 },
  'src/hooks/ai/useAiMasking.ts': { raw: 10, typed: 9 },
  'src/hooks/app/useAppContextMenus.ts': { raw: 26, typed: 10 },
  'src/hooks/app/useAppInitialization.ts': { raw: 6, typed: 5 },
  'src/hooks/app/useAppNavigation.ts': { raw: 14, typed: 10 },
  'src/hooks/editor/useEditorActions.ts': { raw: 8, typed: 3 },
  'src/hooks/library/useFileOperations.ts': { raw: 0, typed: 0 },
  'src/hooks/editor/useImageLoader.ts': { raw: 3, typed: 2 },
  'src/hooks/editor/useImageProcessing.ts': { raw: 5, typed: 0 },
  'src/hooks/library/useLibraryActions.ts': { raw: 8, typed: 3 },
  'src/hooks/editor/usePresets.ts': { raw: 5, typed: 3 },
  'src/hooks/app/useProductivityActions.ts': { raw: 9, typed: 1 },
  'src/hooks/library/useThumbnails.ts': { raw: 2, typed: 0 },
  'src/utils/frontendLogBridge.ts': { raw: 1, typed: 0 },
};

export const inspectTauriInvokeSource = (filePath: string, contents: string) => {
  if (filePath === SCHEMA_WRAPPER_PATH) {
    return { importedNames: [], namespaceNames: [], rawCalls: [], typedRawCalls: [] };
  }

  const importedNames = new Set<string>();
  const namespaceNames = new Set<string>();
  const rawCalls: number[] = [];
  const typedRawCalls: number[] = [];

  visitSource(parseSource(filePath, contents), (node) => {
    if (node.type === 'ImportDeclaration' && node.source.value === '@tauri-apps/api/core') {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          namespaceNames.add(specifier.local.name);
          continue;
        }
        if (specifier.type !== 'ImportSpecifier') continue;
        const importedName =
          specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;
        if (importedName === 'invoke') importedNames.add(specifier.local.name);
      }
    }

    if (node.type !== 'CallExpression') return;

    const isNamedInvokeCall = node.callee.type === 'Identifier' && importedNames.has(node.callee.name);
    const isNamespaceInvokeCall =
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.property.type === 'Identifier' &&
      node.callee.property.name === 'invoke' &&
      node.callee.object.type === 'Identifier' &&
      namespaceNames.has(node.callee.object.name);

    if (isNamedInvokeCall || isNamespaceInvokeCall) {
      const line = lineAtOffset(contents, node.start);
      rawCalls.push(line);
      if ((node.typeArguments?.params.length ?? 0) > 0) typedRawCalls.push(line);
    }
  });
  return { importedNames: [...importedNames], namespaceNames: [...namespaceNames], rawCalls, typedRawCalls };
};

const collectBoundaryFailures = (inventory, approvedBudget = APPROVED_RAW_INVOKE_BUDGET) => {
  const failures = [];
  for (const item of inventory) {
    if (item.rawCalls.length === 0 && item.typedRawCalls.length === 0) continue;

    const approved = approvedBudget[item.path];
    if (!approved) {
      failures.push(`${item.path}: raw invoke is not allowlisted`);
      continue;
    }

    if (item.rawCalls.length > approved.raw) {
      failures.push(`${item.path}: raw invoke calls ${item.rawCalls.length}/${approved.raw}`);
    }
    if (item.typedRawCalls.length > approved.typed) {
      failures.push(`${item.path}: typed raw invoke calls ${item.typedRawCalls.length}/${approved.typed}`);
    }
  }
  return failures;
};

const runSelfTest = () => {
  const blocked = inspectTauriInvokeSource(
    'src/App.tsx',
    `import { invoke as callTauri } from '@tauri-apps/api/core';
const value = await callTauri<string>('load_settings');`,
  );
  const ignored = inspectTauriInvokeSource(
    'src/App.tsx',
    `const text = "import { invoke } from '@tauri-apps/api/core'";
const value = await invoke<string>('not_imported');`,
  );
  const wrapper = inspectTauriInvokeSource(
    SCHEMA_WRAPPER_PATH,
    `import { invoke } from '@tauri-apps/api/core';
const payload = await invoke<unknown>(command, args);`,
  );
  const namespace = inspectTauriInvokeSource(
    'src/App.tsx',
    `import * as tauri from '@tauri-apps/api/core';
const value = await tauri.invoke<string>('load_settings');`,
  );
  const voidInvoke = inspectTauriInvokeSource(
    'src/App.tsx',
    `import { invoke } from '@tauri-apps/api/core';
void invoke('frontend_ready').catch(console.error);`,
  );

  if (blocked.importedNames.length !== 1 || blocked.rawCalls.length !== 1 || blocked.typedRawCalls.length !== 1) {
    throw new Error('tauri invoke self-test failed: raw typed invoke was not detected');
  }
  if (ignored.importedNames.length !== 0 || ignored.rawCalls.length !== 0 || ignored.typedRawCalls.length !== 0) {
    throw new Error('tauri invoke self-test failed: strings or unimported identifiers were counted');
  }
  if (wrapper.importedNames.length !== 0 || wrapper.rawCalls.length !== 0 || wrapper.typedRawCalls.length !== 0) {
    throw new Error('tauri invoke self-test failed: schema wrapper was not allowlisted');
  }
  if (
    namespace.namespaceNames.length !== 1 ||
    namespace.rawCalls.length !== 1 ||
    namespace.typedRawCalls.length !== 1
  ) {
    throw new Error('tauri invoke self-test failed: namespace invoke was not detected');
  }
  if (voidInvoke.rawCalls.length !== 1 || voidInvoke.typedRawCalls.length !== 0) {
    throw new Error('tauri invoke self-test failed: void invoke exception was not classified');
  }

  const blockedFailures = collectBoundaryFailures([{ path: 'src/NewFeature.ts', ...blocked }], {});
  if (blockedFailures.length !== 1 || !blockedFailures[0].includes('not allowlisted')) {
    throw new Error('tauri invoke self-test failed: raw typed invoke was not rejected');
  }

  const wrapperFailures = collectBoundaryFailures([{ path: SCHEMA_WRAPPER_PATH, ...wrapper }], {});
  if (wrapperFailures.length !== 0) {
    throw new Error('tauri invoke self-test failed: wrapper was rejected');
  }

  const voidFailures = collectBoundaryFailures([{ path: 'src/App.tsx', ...voidInvoke }], {
    'src/App.tsx': { raw: 1, typed: 0 },
  });
  if (voidFailures.length !== 0) {
    throw new Error('tauri invoke self-test failed: void invoke budget exception was rejected');
  }

  console.log('tauri invoke boundary self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const root = process.cwd();
const files = walkRepoFiles({ include: ({ entry }) => CHECKED_EXTENSIONS.has(getExtension(entry)) });
const inventory = [];
for (const file of files) {
  const repoPath = toRepoPath(root, file);
  const result = inspectTauriInvokeSource(repoPath, readFileSync(file, 'utf8'));
  if (result.importedNames.length > 0 || result.rawCalls.length > 0) {
    inventory.push({ path: repoPath, ...result });
  }
}

const rawImportFiles = inventory.filter((item) => item.importedNames.length > 0 || item.namespaceNames.length > 0);
const rawCallCount = inventory.reduce((total, item) => total + item.rawCalls.length, 0);
const typedRawCallCount = inventory.reduce((total, item) => total + item.typedRawCalls.length, 0);

const failures = collectBoundaryFailures(inventory);

if (failures.length > 0) {
  const examples = inventory
    .filter((item) => item.rawCalls.length > 0)
    .slice(0, 12)
    .map((item) => `${item.path}: raw=${item.rawCalls.length}, typed=${item.typedRawCalls.length}`)
    .join('\n');
  console.error(`Raw Tauri invoke is banned outside the schema wrapper or approved baseline: ${failures.join('; ')}`);
  if (examples) console.error(examples);
  process.exit(1);
}

console.log(
  `tauri invoke boundaries ok (files ${rawImportFiles.length}, raw ${rawCallCount}, typed ${typedRawCallCount})`,
);
