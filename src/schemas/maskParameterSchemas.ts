import { z } from 'zod';

export const aiDepthMaskParametersSchema = z.object({
  feather: z.number(),
  maxDepth: z.number(),
  maxFade: z.number(),
  minDepth: z.number(),
  minFade: z.number(),
});

export type AiDepthMaskParameters = z.infer<typeof aiDepthMaskParametersSchema>;
