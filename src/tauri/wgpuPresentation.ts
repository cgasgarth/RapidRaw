import { z } from 'zod';
import { emptyTauriResponseSchema } from '../schemas/tauriResponseSchemas';
import { invokeWithSchema } from '../utils/tauriSchemaInvoke';
import type { WgpuTransformPayload } from '../utils/wgpuTransformPayload';
import { Invokes } from './commands';

const wgpuPresentationSequenceSchema = z.number().int().nonnegative();

export const submitWgpuTransform = async (payload: WgpuTransformPayload): Promise<number> =>
  invokeWithSchema(
    Invokes.UpdateWgpuTransform,
    { payload },
    wgpuPresentationSequenceSchema,
    'WGPU presentation sequence',
  );

export const flushWgpuPresentation = async (sequence: number): Promise<void> => {
  await invokeWithSchema(
    Invokes.FlushWgpuPresentation,
    { sequence: wgpuPresentationSequenceSchema.parse(sequence) },
    emptyTauriResponseSchema,
    'WGPU presentation flush',
  );
};
