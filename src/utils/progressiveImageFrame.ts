import type { ProgressiveImageFrameReceipt } from '../schemas/imageLoaderSchemas';

export function canPublishProvisionalFrame({
  current,
  incoming,
  expectedGeneration,
}: {
  current: ProgressiveImageFrameReceipt | null;
  incoming: ProgressiveImageFrameReceipt;
  expectedGeneration: number;
}): boolean {
  return (
    incoming.quality !== 'settledDeveloped' &&
    incoming.imageSession === expectedGeneration &&
    incoming.selectionGeneration === expectedGeneration &&
    (current === null || (current.quality !== 'settledDeveloped' && incoming.frameGeneration > current.frameGeneration))
  );
}

export function isAuthoritativeFrame(receipt: ProgressiveImageFrameReceipt | null): boolean {
  return receipt?.quality === 'settledDeveloped';
}

export type AuthoritativeFrameConsumer = 'analytics' | 'compare' | 'export' | 'mask' | 'proof' | 'sampler';

export function canUseFrameForAuthoritativeConsumer(
  receipt: ProgressiveImageFrameReceipt | null,
  _consumer: AuthoritativeFrameConsumer,
): boolean {
  return isAuthoritativeFrame(receipt);
}
