import { z } from 'zod';

export const channelMixerOutputSchema = z.enum(['red', 'green', 'blue']);
export const channelMixerSourceSchema = z.enum(['red', 'green', 'blue', 'constant']);

const channelMixerRowSchema = z
  .object({
    blue: z.number().min(-200).max(200),
    constant: z.number().min(-100).max(100),
    green: z.number().min(-200).max(200),
    red: z.number().min(-200).max(200),
  })
  .strict();

export const channelMixerSettingsSchema = z
  .object({
    blue: channelMixerRowSchema,
    enabled: z.boolean(),
    green: channelMixerRowSchema,
    preserveLuminance: z.boolean(),
    red: channelMixerRowSchema,
  })
  .strict()
  .superRefine((settings, context) => {
    const rows = [settings.red, settings.green, settings.blue];
    const changed = rows.some(
      (row, index) =>
        row.red !== (index === 0 ? 100 : 0) ||
        row.green !== (index === 1 ? 100 : 0) ||
        row.blue !== (index === 2 ? 100 : 0) ||
        row.constant !== 0,
    );
    if (settings.enabled && !changed) {
      context.addIssue({
        code: 'custom',
        message: 'Enabled channel mixer requires at least one non-identity output row.',
        path: ['enabled'],
      });
    }
  });

export type ChannelMixerOutput = z.infer<typeof channelMixerOutputSchema>;
export type ChannelMixerSource = z.infer<typeof channelMixerSourceSchema>;
export type ChannelMixerSettings = z.infer<typeof channelMixerSettingsSchema>;

export const parseChannelMixerSettings = (value: unknown): ChannelMixerSettings =>
  channelMixerSettingsSchema.parse(value);
