import { emptyTauriResponseSchema } from '../schemas/tauriResponseSchemas';
import { invokeWithSchema } from '../utils/tauriSchemaInvoke';
import { Invokes } from './commands';

export const clearNativeImageCaches = async (): Promise<void> => {
  await invokeWithSchema(Invokes.ClearImageCaches, {}, emptyTauriResponseSchema, 'native image cache clear');
};
