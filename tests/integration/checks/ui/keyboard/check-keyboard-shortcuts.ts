#!/usr/bin/env bun

import { keyboardShortcutComboSchema } from '../../../../../src/schemas/keyboardShortcutSchemas.ts';
import { KEYBIND_DEFINITIONS, KEYBIND_SECTIONS } from '../../../../../src/utils/keyboardUtils.ts';

const failures: string[] = [];
const actions = new Set<string>();
const sections = new Set(KEYBIND_SECTIONS.map((section) => section.id));

for (const definition of KEYBIND_DEFINITIONS) {
  if (actions.has(definition.action)) {
    failures.push(`Duplicate keybind action: ${definition.action}`);
  }
  actions.add(definition.action);

  if (!sections.has(definition.section)) {
    failures.push(`Unknown section for ${definition.action}: ${definition.section}`);
  }

  const parsedCombo = keyboardShortcutComboSchema.safeParse(definition.defaultCombo);
  if (!parsedCombo.success) {
    failures.push(`${definition.action} has invalid default combo: ${parsedCombo.error.message}`);
  }

  if (!definition.description.startsWith('settings.keybinds.actions.')) {
    failures.push(`${definition.action} description must use settings.keybinds.actions.*`);
  }
}

if (failures.length > 0) {
  console.error('Keyboard shortcut validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${KEYBIND_DEFINITIONS.length} keyboard shortcut definitions.`);
