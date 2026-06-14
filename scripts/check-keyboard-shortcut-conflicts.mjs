#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { keyboardShortcutComboSchema, keyboardShortcutMapSchema } from '../src/schemas/keyboardShortcutSchemas.ts';
import {
  findEffectiveKeyboardShortcutConflicts,
  findKeyboardShortcutConflicts,
} from '../src/utils/keyboardShortcutConflicts.ts';

const conflictSchema = z
  .object({
    actions: z.array(z.string().min(1)).min(2),
    combo: keyboardShortcutComboSchema,
    comboKey: z.string().min(1),
  })
  .strict();

const fixtureSchema = z
  .object({
    definitions: z
      .array(
        z
          .object({
            action: z.string().min(1),
            defaultCombo: keyboardShortcutComboSchema,
          })
          .strict(),
      )
      .optional(),
    expectedConflicts: z.array(conflictSchema),
    expectedEffectiveConflicts: z.array(conflictSchema).optional(),
    id: z.string().min(1),
    shortcuts: keyboardShortcutMapSchema,
  })
  .strict();

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/keyboard-shortcuts/conflict-fixtures.json'), 'utf8')));

for (const fixture of fixtures) {
  const actualConflicts = findKeyboardShortcutConflicts(fixture.shortcuts);
  if (JSON.stringify(actualConflicts) !== JSON.stringify(fixture.expectedConflicts)) {
    console.error(`${fixture.id}: keyboard shortcut conflict mismatch`);
    console.error(JSON.stringify({ actualConflicts, expectedConflicts: fixture.expectedConflicts }, null, 2));
    process.exit(1);
  }

  if (fixture.definitions !== undefined && fixture.expectedEffectiveConflicts !== undefined) {
    const actualEffectiveConflicts = findEffectiveKeyboardShortcutConflicts(fixture.definitions, fixture.shortcuts);
    if (JSON.stringify(actualEffectiveConflicts) !== JSON.stringify(fixture.expectedEffectiveConflicts)) {
      console.error(`${fixture.id}: effective keyboard shortcut conflict mismatch`);
      console.error(
        JSON.stringify(
          { actualEffectiveConflicts, expectedEffectiveConflicts: fixture.expectedEffectiveConflicts },
          null,
          2,
        ),
      );
      process.exit(1);
    }
  }
}

console.log(`Validated ${fixtures.length} keyboard shortcut conflict fixtures.`);
