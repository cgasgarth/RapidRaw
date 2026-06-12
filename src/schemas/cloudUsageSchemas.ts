import { z } from 'zod';

export const cloudUsageSchema = z.object({
  limit: z.number(),
  month: z.string(),
  requests: z.number(),
});

export type CloudUsage = z.infer<typeof cloudUsageSchema>;
