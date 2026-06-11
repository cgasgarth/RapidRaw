import { z } from 'zod';
import type { JsonValue } from '../utils/adjustments';

const jsonPrimitiveSchema = z.union([z.boolean(), z.null(), z.number(), z.string()]);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

const aiPatchDataSchema = z
  .record(z.string(), jsonValueSchema)
  .refine((value) => Object.keys(value).length > 0, 'Expected AI patch data object');

export const parseAiPatchDataJson = (value: string): JsonValue => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid AI patch data JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  return aiPatchDataSchema.parse(parsed);
};
