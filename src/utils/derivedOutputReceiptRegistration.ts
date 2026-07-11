import type { DerivedOutputReceipt } from '../schemas/computational-merge/derivedOutputReceiptSchemas';

export interface RegisterCurrentDerivedOutputReceiptOptions {
  build: () => DerivedOutputReceipt;
  isCurrent: () => boolean;
  onRegistrationError?: (error: unknown) => void;
  upsert: (receipt: DerivedOutputReceipt) => void;
}

export const registerCurrentDerivedOutputReceipt = ({
  build,
  isCurrent,
  onRegistrationError,
  upsert,
}: RegisterCurrentDerivedOutputReceiptOptions): DerivedOutputReceipt | null => {
  if (!isCurrent()) return null;

  try {
    const receipt = build();
    if (!isCurrent()) return null;
    upsert(receipt);
    return receipt;
  } catch (error) {
    onRegistrationError?.(error);
    return null;
  }
};
