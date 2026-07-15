import type { PreviewQualityStatus } from './adaptivePreviewQuality';
import { fingerprintPreviewOperationIdentity, type PreviewOperationIdentity } from './previewCoordinator';

export interface WgpuImageSessionIdentity {
  readonly imageSessionId: number;
  readonly sourceImagePath: string;
}

export interface WgpuPreviewCommit {
  readonly identity: PreviewOperationIdentity;
  readonly previewQualityStatus: PreviewQualityStatus;
  readonly renderedPreviewResolution?: number;
}

const imageSessionKey = (identity: WgpuImageSessionIdentity): string =>
  JSON.stringify([identity.imageSessionId, identity.sourceImagePath]);

const operationBelongsToSession = (operation: PreviewOperationIdentity, sessionKey: string): boolean =>
  imageSessionKey({
    imageSessionId: operation.session.imageSessionId,
    sourceImagePath: operation.session.sourceImagePath,
  }) === sessionKey;

/** Joins the accepted frontend operation with the exact native frame receipt. */
export class WgpuFramePresentationAuthority {
  private accepted: WgpuPreviewCommit | null = null;
  private readonly readyFrames = new Set<string>();
  private sessionKey: string | null = null;

  installImageSession(identity: WgpuImageSessionIdentity | null): void {
    const nextKey = identity === null ? null : imageSessionKey(identity);
    if (nextKey === this.sessionKey) return;
    this.sessionKey = nextKey;
    this.accepted = null;
    this.readyFrames.clear();
  }

  acceptPreview(commit: WgpuPreviewCommit): WgpuPreviewCommit | null {
    if (this.sessionKey === null || !operationBelongsToSession(commit.identity, this.sessionKey)) return null;
    this.accepted = commit;
    return this.tryCommit(commit.identity);
  }

  recordFrameReady(identity: PreviewOperationIdentity): WgpuPreviewCommit | null {
    if (this.sessionKey === null || !operationBelongsToSession(identity, this.sessionKey)) return null;
    this.readyFrames.add(fingerprintPreviewOperationIdentity(identity));
    return this.tryCommit(identity);
  }

  private tryCommit(identity: PreviewOperationIdentity): WgpuPreviewCommit | null {
    const operationKey = fingerprintPreviewOperationIdentity(identity);
    if (
      this.accepted === null ||
      fingerprintPreviewOperationIdentity(this.accepted.identity) !== operationKey ||
      !this.readyFrames.has(operationKey)
    ) {
      return null;
    }
    const committed = this.accepted;
    this.accepted = null;
    this.readyFrames.clear();
    return committed;
  }
}

export const wgpuFramePresentationAuthority = new WgpuFramePresentationAuthority();
