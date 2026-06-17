import { z } from 'zod';

interface UniqueStringArrayOptions {
  duplicateLabel?: string;
}

export const uniqueStringArraySchema = (fieldName: string, options: UniqueStringArrayOptions = {}) =>
  z.array(z.string().trim().min(1)).superRefine((values, context) => {
    const seen = new Set<string>();
    for (const [index, value] of values.entries()) {
      if (seen.has(value)) {
        context.addIssue({
          code: 'custom',
          message: `${fieldName} must not contain duplicate ${options.duplicateLabel ?? 'entries'}.`,
          path: [index],
        });
      }
      seen.add(value);
    }
  });
