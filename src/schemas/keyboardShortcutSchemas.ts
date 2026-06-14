import { z } from 'zod';

const modifierSchema = z.enum(['ctrl', 'shift', 'alt']);

const shortcutKeyCodeSchema = z
  .string()
  .refine(
    (value) =>
      /^Key[A-Z]$/.test(value) ||
      /^Digit[0-9]$/.test(value) ||
      /^F([1-9]|1[0-9]|2[0-4])$/.test(value) ||
      /^Numpad[0-9]$/.test(value) ||
      [
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'Backquote',
        'Backslash',
        'Backspace',
        'BracketLeft',
        'BracketRight',
        'CapsLock',
        'Comma',
        'Delete',
        'End',
        'Enter',
        'Equal',
        'Escape',
        'Home',
        'Insert',
        'Minus',
        'NumpadAdd',
        'NumpadComma',
        'NumpadDecimal',
        'NumpadDivide',
        'NumpadEnter',
        'NumpadEqual',
        'NumpadMultiply',
        'NumpadSubtract',
        'PageDown',
        'PageUp',
        'Period',
        'PrintScreen',
        'Quote',
        'Semicolon',
        'Slash',
        'Space',
        'Tab',
      ].includes(value),
    { message: 'Shortcut key must be a KeyboardEvent.code value supported by RapidRaw.' },
  );

export const keyboardShortcutComboSchema = z
  .array(z.union([modifierSchema, shortcutKeyCodeSchema]))
  .superRefine((combo, context) => {
    if (combo.length === 0) return;

    const seen = new Set<string>();
    for (const part of combo) {
      if (seen.has(part)) {
        context.addIssue({
          code: 'custom',
          message: `Shortcut combo contains duplicate part: ${part}`,
        });
      }
      seen.add(part);
    }

    const keyParts = combo.filter((part) => !modifierSchema.safeParse(part).success);
    if (keyParts.length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Shortcut combo must contain exactly one non-modifier key.',
      });
    }

    const firstKeyIndex = combo.findIndex((part) => !modifierSchema.safeParse(part).success);
    if (firstKeyIndex !== -1 && firstKeyIndex !== combo.length - 1) {
      context.addIssue({
        code: 'custom',
        message: 'Shortcut combo modifiers must come before the key code.',
      });
    }
  });

export const keyboardShortcutMapSchema = z.record(z.string().min(1), keyboardShortcutComboSchema);

export type KeyboardShortcutCombo = z.infer<typeof keyboardShortcutComboSchema>;
export type KeyboardShortcutMap = z.infer<typeof keyboardShortcutMapSchema>;

export const parseKeyboardShortcutMap = (value: unknown): KeyboardShortcutMap => keyboardShortcutMapSchema.parse(value);

export const parseKeyboardShortcutCombo = (value: unknown): KeyboardShortcutCombo =>
  keyboardShortcutComboSchema.parse(value);

export const normalizeKeyboardShortcutMap = (
  value: unknown,
  allowedActions: ReadonlySet<string>,
): KeyboardShortcutMap => {
  const parsed = keyboardShortcutMapSchema.safeParse(value);
  if (!parsed.success) {
    return {};
  }

  return Object.fromEntries(Object.entries(parsed.data).filter(([action]) => allowedActions.has(action)));
};
