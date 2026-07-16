import { z } from 'zod';
import { type EditDocumentV2, editDocumentV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';

const positiveIntegerSchema = z.number().int().positive().safe();

const presetPreviewIdentitySchema = z
  .object({
    imageSessionId: positiveIntegerSchema,
    presetId: z.string().trim().min(1),
    requestId: positiveIntegerSchema,
    sourceImagePath: z.string().trim().min(1),
  })
  .strict();

export type PresetPreviewIdentity = z.infer<typeof presetPreviewIdentitySchema>;

export const presetPreviewInvokeArgsSchema = z
  .object({
    request: z
      .object({
        expectedImagePath: z.string().trim().min(1),
        editDocumentV2: editDocumentV2Schema,
        previewIdentity: presetPreviewIdentitySchema,
      })
      .strict(),
  })
  .strict();

const byteSchema = z.number().int().min(0).max(255);

export const presetPreviewByteResponseSchema = z
  .union([z.instanceof(Uint8Array), z.array(byteSchema).min(1)])
  .transform((bytes) => (bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)))
  .refine((bytes) => bytes.byteLength > 0, 'Preset preview bytes must not be empty.');

export interface PresetPreviewImageSession {
  readonly imageSessionId: number;
  readonly sourceImagePath: string;
}

const sessionKey = (session: PresetPreviewImageSession): string =>
  JSON.stringify([session.imageSessionId, session.sourceImagePath]);

/** Owns preset-preview requests across same-path reopen and panel teardown. */
export class PresetPreviewAuthority {
  private currentSession: PresetPreviewImageSession | null = null;
  private readonly latestRequestByPreset = new Map<string, number>();
  private nextRequestId = 1;

  installImageSession(session: PresetPreviewImageSession | null): boolean {
    if (session !== null && this.currentSession !== null && sessionKey(session) === sessionKey(this.currentSession)) {
      return false;
    }
    this.currentSession = session;
    this.latestRequestByPreset.clear();
    this.nextRequestId = 1;
    return true;
  }

  invalidatePending(): void {
    this.latestRequestByPreset.clear();
  }

  issue(presetId: string, editDocumentV2: EditDocumentV2): z.infer<typeof presetPreviewInvokeArgsSchema> {
    if (this.currentSession === null) throw new Error('Preset preview requires a current image session.');
    const identity: PresetPreviewIdentity = {
      imageSessionId: this.currentSession.imageSessionId,
      presetId,
      requestId: this.nextRequestId++,
      sourceImagePath: this.currentSession.sourceImagePath,
    };
    this.latestRequestByPreset.set(identity.presetId, identity.requestId);
    return presetPreviewInvokeArgsSchema.parse({
      request: {
        expectedImagePath: this.currentSession.sourceImagePath,
        editDocumentV2,
        previewIdentity: identity,
      },
    });
  }

  accepts(identity: PresetPreviewIdentity): boolean {
    return (
      this.currentSession !== null &&
      identity.imageSessionId === this.currentSession.imageSessionId &&
      identity.sourceImagePath === this.currentSession.sourceImagePath &&
      this.latestRequestByPreset.get(identity.presetId) === identity.requestId
    );
  }
}
