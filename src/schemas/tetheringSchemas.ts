import { z } from 'zod';

export const tetherCapabilitySchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  status: z.enum(['ready', 'not_checked', 'unavailable']),
});

export const tetheredCameraSchema = z.object({
  batteryPercent: z.number().int().min(0).max(100).nullable(),
  capabilities: z.array(tetherCapabilitySchema),
  connection: z.object({
    transport: z.string().trim().min(1),
    trusted: z.boolean(),
  }),
  displayName: z.string().trim().min(1),
  id: z.string().trim().min(1),
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  storage: z.object({
    freeGb: z.number().nonnegative().nullable(),
    label: z.string().trim().min(1),
    state: z.enum(['ready', 'unknown', 'unavailable']),
  }),
});

export const tetherDiscoveryResponseSchema = z.object({
  cameras: z.array(tetheredCameraSchema),
  proof: z.object({
    fakeProviderAvailable: z.boolean(),
    macosProviderBoundary: z.string().trim().min(1),
    manualHardwareRequired: z.boolean(),
  }),
  provider: z.object({
    adapter: z.string().trim().min(1),
    message: z.string().trim().min(1),
    mode: z.enum(['auto', 'fake']),
    status: z.enum(['ready', 'hardware_adapter_pending']),
  }),
});

export const tetherSessionSnapshotSchema = z.object({
  cameraDisplayName: z.string().trim().min(1),
  cameraId: z.string().trim().min(1),
  destinationRoot: z.string().trim().min(1).nullable(),
  openedAt: z.string().trim().min(1),
  providerMode: z.enum(['auto', 'fake']),
  sessionId: z.string().trim().min(1),
  status: z.literal('open'),
});

export const tetherSessionResponseSchema = z.object({
  session: tetherSessionSnapshotSchema.nullable(),
  status: z.enum(['open', 'closed']),
});

export type TetherCapability = z.infer<typeof tetherCapabilitySchema>;
export type TetherDiscoveryResponse = z.infer<typeof tetherDiscoveryResponseSchema>;
export type TetherSessionResponse = z.infer<typeof tetherSessionResponseSchema>;
export type TetherSessionSnapshot = z.infer<typeof tetherSessionSnapshotSchema>;
export type TetheredCamera = z.infer<typeof tetheredCameraSchema>;
