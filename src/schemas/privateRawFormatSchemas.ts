import { z } from 'zod';

export const PRIVATE_RAW_FORMAT_IDS = ['arw', 'cr2', 'cr3', 'dng', 'nef', 'raf', 'rw2', 'orf', 'pef', 'srw'] as const;

export const privateRawFormatSchema = z.enum(PRIVATE_RAW_FORMAT_IDS);

export type PrivateRawFormat = z.infer<typeof privateRawFormatSchema>;
