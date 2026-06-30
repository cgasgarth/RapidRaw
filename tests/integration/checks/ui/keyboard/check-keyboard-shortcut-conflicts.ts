#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  keyboardShortcutComboSchema,
  keyboardShortcutMapSchema,
} from '../../../../../src/schemas/keyboardShortcutSchemas.ts';
import { findKeyboardShortcutConflicts } from '../../../../../src/utils/keyboardShortcutConflicts.ts';

const conflictSchema = z
  .object({
    actions: z.array(z.string().min(1)).min(2),
    combo: keyboardShortcutComboSchema,
    comboKey: z.string().min(1),
  })
  .strict();

const fixtureSchema = z
  .object({
    expectedConflicts: z.array(conflictSchema),
    id: z.string().min(1),
    shortcuts: keyboardShortcutMapSchema,
  })
  .strict();

const fixturesJson: unknown = JSON.parse(
  readFileSync(resolve('fixtures/keyboard-shortcuts/conflict-fixtures.json'), 'utf8'),
);
const fixtures = z.array(fixtureSchema).min(1).parse(fixturesJson);

for (const fixture of fixtures) {
  const actualConflicts = findKeyboardShortcutConflicts(fixture.shortcuts);
  if (JSON.stringify(actualConflicts) !== JSON.stringify(fixture.expectedConflicts)) {
    console.error(`${fixture.id}: keyboard shortcut conflict mismatch`);
    console.error(JSON.stringify({ actualConflicts, expectedConflicts: fixture.expectedConflicts }, null, 2));
    process.exit(1);
  }
}

console.log(`Validated ${fixtures.length} keyboard shortcut conflict fixtures.`);
