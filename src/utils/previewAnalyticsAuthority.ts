import {
  fingerprintPreviewOperationIdentity,
  type PreviewArtifact,
  type PreviewOperationIdentity,
} from './previewCoordinator';

export interface PreviewAnalyticsEnvelope {
  path: string;
  previewOperationIdentity: PreviewOperationIdentity;
}

export const isExactPresentedPreviewAnalytics = (
  result: PreviewAnalyticsEnvelope,
  artifact: PreviewArtifact | null,
): boolean =>
  artifact !== null &&
  result.path === result.previewOperationIdentity.session.sourceImagePath &&
  result.path === artifact.identity.session.sourceImagePath &&
  result.previewOperationIdentity.session.imageSessionId === artifact.identity.session.imageSessionId &&
  result.previewOperationIdentity.session.graphRevision === artifact.identity.session.graphRevision &&
  fingerprintPreviewOperationIdentity(result.previewOperationIdentity) ===
    fingerprintPreviewOperationIdentity(artifact.identity);

/** Bridges early native results to exact frontend presentation authority. */
export class PreviewAnalyticsAuthority<TResult extends PreviewAnalyticsEnvelope> {
  private readonly pending = new Map<string, TResult>();
  private presented: PreviewArtifact | null = null;

  receive(result: TResult): TResult | null {
    if (isExactPresentedPreviewAnalytics(result, this.presented)) return result;
    const fingerprint = fingerprintPreviewOperationIdentity(result.previewOperationIdentity);
    this.pending.delete(fingerprint);
    this.pending.set(fingerprint, result);
    while (this.pending.size > 4) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
    return null;
  }

  setPresented(artifact: PreviewArtifact | null): TResult | null {
    this.presented = artifact;
    if (artifact === null) {
      this.pending.clear();
      return null;
    }
    const fingerprint = fingerprintPreviewOperationIdentity(artifact.identity);
    const result = this.pending.get(fingerprint) ?? null;
    this.pending.clear();
    return result !== null && isExactPresentedPreviewAnalytics(result, artifact) ? result : null;
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
