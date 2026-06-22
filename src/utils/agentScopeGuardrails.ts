import { z } from 'zod';

const agentScopeGuardrailRequestSchema = z
  .object({
    outputPath: z.string().trim().min(1),
    overwriteOriginal: z.boolean().default(false),
    selectedRoot: z.string().trim().min(1),
    sourceRawPath: z.string().trim().min(1),
  })
  .strict();

export type AgentScopeGuardrailRequest = z.input<typeof agentScopeGuardrailRequestSchema>;

export interface AgentScopeGuardrailResult {
  ok: true;
  normalizedOutputPath: string;
}

const normalizePath = (path: string): string => path.replaceAll('\\', '/').replace(/\/+/gu, '/');

const isWithinRoot = (path: string, root: string): boolean => {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root).replace(/\/$/u, '');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
};

export const validateAgentLocalScope = (request: AgentScopeGuardrailRequest): AgentScopeGuardrailResult => {
  const parsed = agentScopeGuardrailRequestSchema.parse(request);
  const sourceRawPath = normalizePath(parsed.sourceRawPath);
  const outputPath = normalizePath(parsed.outputPath);

  if (!isWithinRoot(sourceRawPath, parsed.selectedRoot)) {
    throw new Error('Agent source RAW is outside the selected local scope.');
  }
  if (!isWithinRoot(outputPath, parsed.selectedRoot)) {
    throw new Error('Agent output path is outside the selected local scope.');
  }
  if (outputPath === sourceRawPath || parsed.overwriteOriginal) {
    throw new Error('Agent output must not overwrite the immutable source RAW.');
  }

  return { normalizedOutputPath: outputPath, ok: true };
};
