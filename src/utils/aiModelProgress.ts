import { z } from 'zod';

const aiModelProgressSchema = z.object({
  modelId: z.string().min(1),
  phase: z.enum(['downloading', 'verifying', 'loading', 'ready', 'failed', 'evicted', 'verified']),
  bytesCurrent: z.number().nonnegative().optional(),
  bytesTotal: z.number().positive().optional(),
  error: z.string().min(1).nullable().optional(),
});

export type AiModelProgress = z.infer<typeof aiModelProgressSchema>;
export type AiModelProgressById = Readonly<Record<string, AiModelProgress>>;

export function parseAiModelProgress(payload: unknown): AiModelProgress | null {
  const result = aiModelProgressSchema.safeParse(payload);
  return result.success ? result.data : null;
}

export function updateAiModelProgress(current: AiModelProgressById, update: AiModelProgress): AiModelProgressById {
  if (update.phase === 'ready' || update.phase === 'verified' || update.phase === 'evicted') {
    const { [update.modelId]: _removed, ...remaining } = current;
    return remaining;
  }
  return { ...current, [update.modelId]: update };
}

export function formatAiModelProgress(progress: AiModelProgressById): string | null {
  const active = Object.values(progress);
  if (active.length === 0) return null;
  return active
    .map((entry) => {
      if (entry.phase === 'failed') return `${entry.modelId}: ${entry.error ?? 'failed'}`;
      if (entry.bytesCurrent === undefined) return `${entry.modelId}: ${entry.phase}`;
      if (entry.bytesTotal === undefined) return `${entry.modelId}: ${entry.bytesCurrent} bytes`;
      const percentage = Math.min(100, Math.round((entry.bytesCurrent / entry.bytesTotal) * 100));
      return `${entry.modelId}: ${percentage}%`;
    })
    .join(' · ');
}
