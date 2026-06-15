import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';

const formatSchemaIssues = (issues: z.core.$ZodIssue[]): string =>
  issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

export function parseTauriPayload<TPayload>(schema: z.ZodType<TPayload>, payload: unknown, context: string): TPayload {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  const issueSummary = formatSchemaIssues(result.error.issues);
  throw new Error(`Invalid Tauri payload for ${context}: ${issueSummary}`);
}

export async function invokeWithSchema<TPayload>(
  command: string,
  args: Record<string, unknown>,
  schema: z.ZodType<TPayload>,
  context: string = command,
): Promise<TPayload> {
  const payload = await invoke<unknown>(command, args);
  return parseTauriPayload(schema, payload, context);
}
