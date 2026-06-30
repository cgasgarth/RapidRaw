import {
  type KeyboardShortcutCombo,
  type KeyboardShortcutMap,
  keyboardShortcutMapSchema,
} from '../schemas/keyboardShortcutSchemas';

export interface KeyboardShortcutConflict {
  actions: Array<string>;
  combo: KeyboardShortcutCombo;
  comboKey: string;
}

export function findKeyboardShortcutConflicts(value: unknown): Array<KeyboardShortcutConflict> {
  const shortcuts = keyboardShortcutMapSchema.parse(value);
  const actionsByCombo = new Map<string, { actions: Array<string>; combo: KeyboardShortcutCombo }>();

  for (const [action, combo] of Object.entries(shortcuts)) {
    if (combo.length === 0) continue;

    const comboKey = combo.join('+');
    const existing = actionsByCombo.get(comboKey);
    if (existing === undefined) {
      actionsByCombo.set(comboKey, { actions: [action], combo });
      continue;
    }

    existing.actions.push(action);
  }

  return [...actionsByCombo.entries()]
    .filter(([, entry]) => entry.actions.length > 1)
    .map(([comboKey, entry]) => ({
      actions: [...entry.actions].sort(),
      combo: entry.combo,
      comboKey,
    }))
    .sort((left, right) => left.comboKey.localeCompare(right.comboKey));
}

export function assertKeyboardShortcutMapHasNoConflicts(shortcuts: KeyboardShortcutMap): void {
  const conflicts = findKeyboardShortcutConflicts(shortcuts);
  if (conflicts.length === 0) return;

  const summary = conflicts.map((conflict) => `${conflict.comboKey}: ${conflict.actions.join(', ')}`).join('; ');
  throw new Error(`Keyboard shortcut conflicts detected: ${summary}`);
}
