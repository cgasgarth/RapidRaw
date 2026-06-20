import { z } from 'zod';

const tauriBoundaryStatusSchema = z.enum([
  'uncovered',
  'schema-only',
  'runtime-parse-tested',
  'rust-parity-tested',
  'e2e-proven',
]);

const rustParityStateSchema = z.enum(['not-tested', 'manual-rust-command-shape', 'serde-parity-tested']);

const tauriBoundaryEntrySchema = z
  .object({
    command: z.string().trim().min(1),
    invokeEnumMember: z.string().regex(/^[A-Z][A-Za-z0-9]+$/u),
    negativeFixturePath: z.string().trim().min(1).optional(),
    notes: z.string().trim().min(1),
    positiveFixturePath: z.string().trim().min(1).optional(),
    rustParityState: rustParityStateSchema,
    status: tauriBoundaryStatusSchema,
    tsCallSites: z.array(z.string().trim().min(1)).min(1),
    zodSchema: z.enum([
      'albumTreeSchema',
      'emptyTauriResponseSchema',
      'fileOperationPathListSchema',
      'folderTreeListSchema',
    ]),
  })
  .strict()
  .superRefine((entry, context) => {
    const parseTested = ['runtime-parse-tested', 'rust-parity-tested', 'e2e-proven'].includes(entry.status);
    if (parseTested && (entry.positiveFixturePath === undefined || entry.negativeFixturePath === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Runtime parse-tested Tauri boundaries require positive and negative fixtures.',
        path: ['status'],
      });
    }

    if (entry.status === 'rust-parity-tested' && entry.rustParityState !== 'serde-parity-tested') {
      context.addIssue({
        code: 'custom',
        message: 'rust-parity-tested boundaries require serde-parity-tested rustParityState.',
        path: ['rustParityState'],
      });
    }
  });

export const tauriBoundaryLedgerSchema = z
  .object({
    $schema: z.url(),
    entries: z.array(tauriBoundaryEntrySchema).min(1),
    issue: z.literal(1301),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict()
  .superRefine((ledger, context) => {
    const commands = ledger.entries.map((entry) => entry.command);
    if (new Set(commands).size !== commands.length) {
      context.addIssue({
        code: 'custom',
        message: 'Tauri boundary ledger commands must be unique.',
        path: ['entries'],
      });
    }

    for (const requiredCommand of ['get_folder_children', 'get_albums', 'rename_files']) {
      if (!commands.includes(requiredCommand)) {
        context.addIssue({
          code: 'custom',
          message: `Tauri boundary ledger missing ${requiredCommand}.`,
          path: ['entries'],
        });
      }
    }
  });

export type TauriBoundaryLedger = z.infer<typeof tauriBoundaryLedgerSchema>;

export function parseTauriBoundaryLedger(value: unknown): TauriBoundaryLedger {
  return tauriBoundaryLedgerSchema.parse(value);
}
