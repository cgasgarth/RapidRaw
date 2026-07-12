import type { ScheduleImagePrefetchRequest } from './imageOpenInvokes';

export interface ImagePrefetchNavigationInput {
  currentPath: string;
  memoryPressure: boolean;
  now: number;
  orderedPaths: string[];
  workloadBusy: boolean;
}

export class ImagePrefetchScheduler {
  private collectionGeneration = 0;
  private lastIndex: number | null = null;
  private lastNavigationAt = 0;
  private orderedIdentity = '';

  schedule(input: ImagePrefetchNavigationInput): ScheduleImagePrefetchRequest {
    const orderedIdentity = input.orderedPaths.join('\u0000');
    if (orderedIdentity !== this.orderedIdentity) {
      this.orderedIdentity = orderedIdentity;
      this.collectionGeneration += 1;
      this.lastIndex = null;
    }
    const index = input.orderedPaths.indexOf(input.currentPath);
    if (index < 0) {
      return this.request([], input);
    }
    const direction = this.lastIndex !== null && index < this.lastIndex ? -1 : 1;
    const rapid = this.lastIndex !== null && input.now - this.lastNavigationAt < 180;
    this.lastIndex = index;
    this.lastNavigationAt = input.now;
    const ahead = input.memoryPressure || input.workloadBusy ? 1 : rapid ? 3 : 2;
    const candidates: string[] = [];
    for (let offset = 1; offset <= ahead; offset += 1) {
      const path = input.orderedPaths[index + direction * offset];
      if (path) candidates.push(path);
    }
    if (!input.memoryPressure && !input.workloadBusy && !rapid) {
      const behind = input.orderedPaths[index - direction];
      if (behind) candidates.push(behind);
    }
    return this.request(candidates, input);
  }

  reset(): void {
    this.orderedIdentity = '';
    this.lastIndex = null;
    this.collectionGeneration += 1;
  }

  private request(candidates: string[], input: ImagePrefetchNavigationInput): ScheduleImagePrefetchRequest {
    return {
      candidates: [...new Set(candidates)].slice(0, 3),
      collectionGeneration: this.collectionGeneration,
      memoryPressure: input.memoryPressure,
      workloadBusy: input.workloadBusy,
    };
  }
}

export const imagePrefetchScheduler = new ImagePrefetchScheduler();
