import { readFileSync } from 'node:fs';

const files = {
  app: readFileSync('src/App.tsx', 'utf8'),
  folderTreeSchema: readFileSync('src/schemas/folderTreeSchemas.ts', 'utf8'),
  packageJson: readFileSync('package.json', 'utf8'),
  tauriInvoke: readFileSync('src/utils/tauriSchemaInvoke.ts', 'utf8'),
};

const required = [
  ['tauri invoke helper uses invoke<unknown>', files.tauriInvoke.includes('invoke<unknown>')],
  ['tauri parse helper uses Zod safeParse', files.tauriInvoke.includes('schema.safeParse(payload)')],
  ['tauri parse helper formats bounded issues', files.tauriInvoke.includes('.slice(0, 5)')],
  ['folder tree schema is recursive Zod', files.folderTreeSchema.includes('z.lazy')],
  ['folder tree schema rejects unknown fields', files.folderTreeSchema.includes('.strict()')],
  ['App imports folderTreeListSchema', files.app.includes("from './schemas/folderTreeSchemas'")],
  ['App imports invokeWithSchema', files.app.includes("from './utils/tauriSchemaInvoke'")],
  [
    'folder children no longer invoke typed array directly',
    !files.app.includes('invoke<FolderTreeNode[]>(Invokes.GetFolderChildren'),
  ],
  ['folder children uses invokeWithSchema', files.app.includes('invokeWithSchema(')],
  ['package exposes check script', files.packageJson.includes('"check:tauri-schema-validation"')],
];

const failures = required.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length > 0) {
  throw new Error(`tauri schema validation check failed: ${failures.join(', ')}`);
}

console.log('tauri schema validation ok');
