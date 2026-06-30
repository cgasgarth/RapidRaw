import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  EDIT_GRAPH_DOCUMENT_KIND,
  LEGACY_EDIT_GRAPH_SCHEMA_VERSION,
  migrateEditGraphDocumentV1,
} from '../src/editGraphMigrations.js';
import { RAW_ENGINE_SCHEMA_VERSION } from '../src/rawEngineSchemas.js';
import { sampleCommandEnvelopeV1 } from '../src/samplePayloads.js';

const policySchema = z
  .object({
    $schema: z.string().url(),
    compatibilityNotes: z.array(z.string().trim().min(1)).min(1),
    documentKind: z.literal(EDIT_GRAPH_DOCUMENT_KIND),
    fromSchemaVersion: z.literal(LEGACY_EDIT_GRAPH_SCHEMA_VERSION),
    issue: z.literal(2323),
    requiredMigrationIds: z.array(z.literal('edit-graph-document-v0-to-v1')).min(1),
    schemaVersion: z.literal(1),
    toSchemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    validationMode: z.literal('edit_graph_schema_migration_policy'),
  })
  .strict();

const policy = policySchema.parse(
  JSON.parse(await readFile('fixtures/validation/compatibility/edit-graph-migration-policy.json', 'utf8')),
);

const legacyDocument = {
  documentId: 'edit_graph_legacy_001',
  graphRevision: 'graph_rev_legacy_001',
  kind: EDIT_GRAPH_DOCUMENT_KIND,
  operations: [{ ...sampleCommandEnvelopeV1, schemaVersion: LEGACY_EDIT_GRAPH_SCHEMA_VERSION }],
  schemaVersion: LEGACY_EDIT_GRAPH_SCHEMA_VERSION,
};

const migrated = migrateEditGraphDocumentV1(legacyDocument);
if (migrated.fromSchemaVersion !== LEGACY_EDIT_GRAPH_SCHEMA_VERSION) {
  throw new Error('Expected legacy migration source version.');
}
if (migrated.document.schemaVersion !== RAW_ENGINE_SCHEMA_VERSION) {
  throw new Error('Expected migrated document schema version.');
}
if (migrated.document.operations[0]?.schemaVersion !== RAW_ENGINE_SCHEMA_VERSION) {
  throw new Error('Expected migrated operation schema version.');
}
if (migrated.migrationIds.join(',') !== 'edit-graph-document-v0-to-v1') {
  throw new Error('Expected deterministic edit graph migration id.');
}
if (migrated.migrationIds.join(',') !== policy.requiredMigrationIds.join(',')) {
  throw new Error('Edit graph migration ids must match the migration policy fixture.');
}

const current = migrateEditGraphDocumentV1(migrated.document);
if (current.migrationIds.length !== 0 || current.fromSchemaVersion !== RAW_ENGINE_SCHEMA_VERSION) {
  throw new Error('Expected current document to be accepted without migration.');
}

expectThrows('unsupported version', () =>
  migrateEditGraphDocumentV1({
    ...legacyDocument,
    schemaVersion: 99,
  }),
);

expectThrows('invalid migrated operation', () =>
  migrateEditGraphDocumentV1({
    ...legacyDocument,
    operations: [{ ...legacyDocument.operations[0], commandType: '' }],
  }),
);

console.log(`edit graph migrations ok (${migrated.migrationIds.length})`);

function expectThrows(label: string, callback: () => void): void {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
