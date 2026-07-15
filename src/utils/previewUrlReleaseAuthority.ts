import type { PreviewCoordinatorState, PreviewCoordinatorTransition } from './previewCoordinator';

type PreviewUrlRelease = (url: string) => void;

interface PreviewUrlReleaseAuthorityOptions {
  isProtected?: (url: string) => boolean;
  release?: PreviewUrlRelease;
}

const isPresentedBySurface = (state: Readonly<PreviewCoordinatorState>, url: string): boolean =>
  state.visibleArtifact?.url === url || state.originalArtifact?.url === url;

/**
 * Exactly-once release authority for one preview ownership phase.
 * Coordinator artifacts already published to a surface transfer ownership to
 * that surface; only never-presented materializations are released here.
 */
export class PreviewUrlReleaseAuthority {
  private readonly isProtected: (url: string) => boolean;
  private readonly releaseUrl: PreviewUrlRelease;
  private readonly releasedUrls = new Set<string>();

  constructor(options: PreviewUrlReleaseAuthorityOptions = {}) {
    this.isProtected = options.isProtected ?? (() => false);
    this.releaseUrl = options.release ?? URL.revokeObjectURL;
  }

  consume(previous: Readonly<PreviewCoordinatorState>, transition: PreviewCoordinatorTransition): readonly string[] {
    const released: string[] = [];
    for (const effect of transition.effects) {
      if (effect.type !== 'release-url' || isPresentedBySurface(previous, effect.url)) continue;
      if (this.release(effect.url)) released.push(effect.url);
    }
    return released;
  }

  release(url: string): boolean {
    if (!url.startsWith('blob:') || this.releasedUrls.has(url) || this.isProtected(url)) return false;
    this.releasedUrls.add(url);
    this.releaseUrl(url);
    return true;
  }

  hasReleased(url: string): boolean {
    return this.releasedUrls.has(url);
  }
}
