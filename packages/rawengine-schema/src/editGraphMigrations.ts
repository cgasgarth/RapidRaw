import { z } from 'zod';

import { commandEnvelopeV1Schema, RAW_ENGINE_SCHEMA_VERSION } from './rawEngineSchemas.js';

export const EDIT_GRAPH_DOCUMENT_KIND = 'rawengine.editGraph';
export const LEGACY_EDIT_GRAPH_SCHEMA_VERSION = 0;

const legacyCommandEnvelopeV0Schema = commandEnvelopeV1Schema
  .omit({ schemaVersion: true })
  .extend({ schemaVersion: z.literal(LEGACY_EDIT_GRAPH_SCHEMA_VERSION) })
  .strict();

export const editGraphDocumentV1Schema = z
  .object({
    documentId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    kind: z.literal(EDIT_GRAPH_DOCUMENT_KIND),
    operations: z.array(commandEnvelopeV1Schema),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
  })
  .strict();

export const legacyEditGraphDocumentV0Schema = editGraphDocumentV1Schema
  .omit({ operations: true, schemaVersion: true })
  .extend({
    operations: z.array(legacyCommandEnvelopeV0Schema),
    schemaVersion: z.literal(LEGACY_EDIT_GRAPH_SCHEMA_VERSION),
  })
  .strict();

export const editGraphMigrationResultV1Schema = z
  .object({
    document: editGraphDocumentV1Schema,
    fromSchemaVersion: z.number().int().nonnegative(),
    migrationIds: z.array(z.string().trim().min(1)),
    toSchemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
  })
  .strict();

export type EditGraphDocumentV1 = z.infer<typeof editGraphDocumentV1Schema>;
export type LegacyEditGraphDocumentV0 = z.infer<typeof legacyEditGraphDocumentV0Schema>;
export type EditGraphMigrationResultV1 = z.infer<typeof editGraphMigrationResultV1Schema>;

export const migrateEditGraphDocumentV1 = (documentValue: unknown): EditGraphMigrationResultV1 => {
  const currentResult = editGraphDocumentV1Schema.safeParse(documentValue);
  if (currentResult.success) {
    return editGraphMigrationResultV1Schema.parse({
      document: currentResult.data,
      fromSchemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      migrationIds: [],
      toSchemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    });
  }

  const legacyResult = legacyEditGraphDocumentV0Schema.safeParse(documentValue);
  if (legacyResult.success) {
    return editGraphMigrationResultV1Schema.parse({
      document: migrateLegacyEditGraphDocumentV0(legacyResult.data),
      fromSchemaVersion: LEGACY_EDIT_GRAPH_SCHEMA_VERSION,
      migrationIds: ['edit-graph-document-v0-to-v1'],
      toSchemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    });
  }

  const schemaVersion = getSchemaVersion(documentValue);
  if (schemaVersion !== undefined && schemaVersion !== RAW_ENGINE_SCHEMA_VERSION) {
    throw new Error(`Unsupported edit graph schemaVersion: ${schemaVersion}.`);
  }

  throw new Error('Invalid edit graph document.');
};

const migrateLegacyEditGraphDocumentV0 = (document: LegacyEditGraphDocumentV0): EditGraphDocumentV1 =>
  editGraphDocumentV1Schema.parse({
    ...document,
    operations: document.operations.map((operation) => ({
      ...operation,
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    })),
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  });

const getSchemaVersion = (value: unknown): number | undefined => {
  const result = z.looseObject({ schemaVersion: z.number().int().nonnegative() }).safeParse(value);
  return result.success ? result.data.schemaVersion : undefined;
};
