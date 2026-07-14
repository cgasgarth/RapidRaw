export type PresentedPreviewUrlRelease = (url: string) => void;
export type PresentedPreviewChannel = 'base' | 'original';

interface PendingRelease {
  readonly channel: PresentedPreviewChannel;
  readonly successorUrl: string | null;
}

export class PresentedPreviewReleaseCoordinator {
  private readonly pendingByUrl = new Map<string, PendingRelease>();

  acknowledge(
    channel: PresentedPreviewChannel,
    successorUrl: string,
    release: PresentedPreviewUrlRelease = URL.revokeObjectURL,
  ): readonly string[] {
    const released: string[] = [];
    for (const [pendingUrl, pending] of this.pendingByUrl) {
      if (pending.channel !== channel || (pending.successorUrl !== null && pending.successorUrl !== successorUrl))
        continue;
      this.pendingByUrl.delete(pendingUrl);
      release(pendingUrl);
      released.push(pendingUrl);
    }
    return released;
  }

  cancel(release: PresentedPreviewUrlRelease = URL.revokeObjectURL): readonly string[] {
    const released = [...this.pendingByUrl.keys()];
    this.pendingByUrl.clear();
    for (const url of released) release(url);
    return released;
  }

  defer(pendingUrl: string, channel: PresentedPreviewChannel, successorUrl: string | null): void {
    if (pendingUrl === successorUrl) return;
    for (const [earlierUrl, pending] of this.pendingByUrl) {
      if (pending.channel !== channel || pending.successorUrl !== pendingUrl) continue;
      if (earlierUrl === successorUrl) this.pendingByUrl.delete(earlierUrl);
      else this.pendingByUrl.set(earlierUrl, { channel, successorUrl });
    }
    this.pendingByUrl.set(pendingUrl, { channel, successorUrl });
  }

  pendingCount(): number {
    return this.pendingByUrl.size;
  }
}

export const presentedPreviewReleaseCoordinator = new PresentedPreviewReleaseCoordinator();
