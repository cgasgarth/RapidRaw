#!/usr/bin/env bun
// @ts-check

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import ts from 'typescript';

const ROOT = process.cwd();
const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx']);
const IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules', 'src-tauri/target', 'target']);
const SCHEMA_WRAPPER_PATH = 'src/utils/tauriSchemaInvoke.ts';

const MAX_RAW_INVOKE_IMPORT_FILES = 29;
const MAX_RAW_INVOKE_CALLS = 154;
const MAX_TYPED_RAW_INVOKE_CALLS = 59;

const getExtension = (path) => extname(path);

const getScriptKind = (path) => (getExtension(path) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const isIgnored = (path) => {
  const normalized = path.split('/').join('/');
  return [...IGNORED_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`));
};

const getLine = (sourceFile, position) => sourceFile.getLineAndCharacterOfPosition(position).line + 1;

export const inspectTauriInvokeSource = (filePath, contents) => {
  if (filePath === SCHEMA_WRAPPER_PATH) {
    return { importedNames: [], rawCalls: [], typedRawCalls: [] };
  }

  const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true, getScriptKind(filePath));
  const importedNames = new Set();
  const namespaceNames = new Set();
  const rawCalls = [];
  const typedRawCalls = [];

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@tauri-apps/api/core'
    ) {
      const namedBindings = node.importClause?.namedBindings;
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (importedName === 'invoke') {
            importedNames.add(element.name.text);
          }
        }
      } else if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        namespaceNames.add(namedBindings.name.text);
      }
    }

    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    const isNamedInvokeCall = ts.isIdentifier(node.expression) && importedNames.has(node.expression.text);
    const isNamespaceInvokeCall =
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'invoke' &&
      ts.isIdentifier(node.expression.expression) &&
      namespaceNames.has(node.expression.expression.text);

    if (isNamedInvokeCall || isNamespaceInvokeCall) {
      const line = getLine(sourceFile, node.getStart(sourceFile));
      rawCalls.push(line);
      if ((node.typeArguments?.length ?? 0) > 0) {
        typedRawCalls.push(line);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { importedNames: [...importedNames], namespaceNames: [...namespaceNames], rawCalls, typedRawCalls };
};

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const repoPath = relative(ROOT, absolutePath);
    if (isIgnored(repoPath)) continue;

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walk(absolutePath);
      continue;
    }

    if (stat.isFile() && CHECKED_EXTENSIONS.has(getExtension(entry))) {
      files.push(absolutePath);
    }
  }
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

  console.log('tauri invoke boundary self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

walk(ROOT);

const inventory = [];
for (const file of files) {
  const repoPath = relative(ROOT, file);
  const result = inspectTauriInvokeSource(repoPath, readFileSync(file, 'utf8'));
  if (result.importedNames.length > 0 || result.rawCalls.length > 0) {
    inventory.push({ path: repoPath, ...result });
  }
}

const rawImportFiles = inventory.filter((item) => item.importedNames.length > 0 || item.namespaceNames.length > 0);
const rawCallCount = inventory.reduce((total, item) => total + item.rawCalls.length, 0);
const typedRawCallCount = inventory.reduce((total, item) => total + item.typedRawCalls.length, 0);

const failures = [];
if (rawImportFiles.length > MAX_RAW_INVOKE_IMPORT_FILES) {
  failures.push(`raw invoke import files ${rawImportFiles.length}/${MAX_RAW_INVOKE_IMPORT_FILES}`);
}
if (rawCallCount > MAX_RAW_INVOKE_CALLS) {
  failures.push(`raw invoke calls ${rawCallCount}/${MAX_RAW_INVOKE_CALLS}`);
}
if (typedRawCallCount > MAX_TYPED_RAW_INVOKE_CALLS) {
  failures.push(`typed raw invoke calls ${typedRawCallCount}/${MAX_TYPED_RAW_INVOKE_CALLS}`);
}

if (failures.length > 0) {
  const examples = inventory
    .filter((item) => item.rawCalls.length > 0)
    .slice(0, 12)
    .map((item) => `${item.path}: raw=${item.rawCalls.length}, typed=${item.typedRawCalls.length}`)
    .join('\n');
  console.error(`Tauri invoke boundary debt increased: ${failures.join('; ')}`);
  if (examples) console.error(examples);
  process.exit(1);
}

console.log(
  `tauri invoke boundaries ok (files ${rawImportFiles.length}/${MAX_RAW_INVOKE_IMPORT_FILES}, raw ${rawCallCount}/${MAX_RAW_INVOKE_CALLS}, typed ${typedRawCallCount}/${MAX_TYPED_RAW_INVOKE_CALLS})`,
);
