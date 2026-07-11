import { z } from 'zod';

const atomicPackageReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  stagingIdentity: z.string().min(1),
  finalPackagePath: z.string().min(1),
  manifestHash: z.string().min(1),
  inventoryHash: z.string().min(1),
  payloadHash: z.string().min(1),
  mapHashes: z.array(z.string().min(1)),
  commitStatus: z.enum(['committed', 'unregistered']),
  recoveryAction: z.string().nullable(),
});

export const burstSrApplyReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  candidateId: z.string().min(1),
  candidateHash: z.string().min(1),
  acceptedReviewHash: z.string().min(1),
  derivedAssetId: z.string().min(1),
  payloadPath: z.string().min(1),
  provenanceStatus: z.enum(['current', 'sources_changed_or_offline']),
  package: atomicPackageReceiptSchema,
});

export type BurstSrApplyReceipt = z.infer<typeof burstSrApplyReceiptSchema>;
