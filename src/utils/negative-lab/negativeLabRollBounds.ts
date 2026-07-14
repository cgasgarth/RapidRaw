import {
  type NegativeLabRollBoundsReceipt,
  type NegativeLabRollBoundsRequest,
  negativeLabRollBoundsReceiptSchema,
  negativeLabRollBoundsRequestSchema,
} from '../../schemas/negative-lab/negativeLabRollBoundsSchemas';
import { Invokes } from '../../tauri/commands';
import { invokeWithSchema } from '../tauriSchemaInvoke';

export const lockNegativeLabRollBounds = async (
  request: NegativeLabRollBoundsRequest,
): Promise<NegativeLabRollBoundsReceipt> => {
  const parsedRequest = negativeLabRollBoundsRequestSchema.parse(request);
  return invokeWithSchema(
    Invokes.LockNegativeLabRollBounds,
    { request: parsedRequest },
    negativeLabRollBoundsReceiptSchema,
  );
};

export const finalBoundsForFrame = (receipt: NegativeLabRollBoundsReceipt, frameId: string) =>
  receipt.frameResults.find((frame) => frame.frameId === frameId)?.finalBounds ?? null;
