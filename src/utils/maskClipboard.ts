import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from './adjustments';

import type { SubMask } from '../components/panel/right/Masks';

export type MaskClipboardIdFactory = () => string;

export interface CloneMaskContainerOptions {
  invert?: boolean | undefined;
  renameTo?: string | undefined;
  resetAdjustments?: boolean | undefined;
}

export interface CloneMaskLikeContainerOptions<TContainer> {
  invert?: boolean | undefined;
  renameTo?: string | undefined;
  resetContainer?: ((container: TContainer) => void) | undefined;
}

export interface CloneSubMaskOptions {
  invert?: boolean | undefined;
  renameTo?: string | undefined;
}

export interface MaskLikeContainer {
  id: string;
  invert: boolean;
  name: string;
  subMasks: Array<SubMask>;
}

export function cloneMaskLikeContainerForPaste<TContainer extends MaskLikeContainer>(
  container: TContainer,
  createId: MaskClipboardIdFactory,
  options: CloneMaskLikeContainerOptions<TContainer> = {},
): TContainer {
  const clonedContainer = structuredClone(container);
  clonedContainer.id = createId();
  clonedContainer.invert = options.invert ? !clonedContainer.invert : clonedContainer.invert;
  clonedContainer.name = options.renameTo ?? clonedContainer.name;
  clonedContainer.subMasks = clonedContainer.subMasks.map((subMask) => ({
    ...subMask,
    id: createId(),
  }));
  options.resetContainer?.(clonedContainer);
  return clonedContainer;
}

export function cloneMaskContainerForPaste(
  container: MaskContainer,
  createId: MaskClipboardIdFactory,
  options: CloneMaskContainerOptions = {},
): MaskContainer {
  return cloneMaskLikeContainerForPaste(container, createId, {
    invert: options.invert,
    renameTo: options.renameTo,
    resetContainer: options.resetAdjustments
      ? (clonedContainer) => {
          clonedContainer.adjustments = structuredClone(INITIAL_MASK_ADJUSTMENTS);
        }
      : undefined,
  });
}

export function cloneSubMaskForPaste(
  subMask: SubMask,
  createId: MaskClipboardIdFactory,
  options: CloneSubMaskOptions = {},
): SubMask {
  const clonedSubMask = structuredClone(subMask);
  clonedSubMask.id = createId();
  clonedSubMask.invert = options.invert ? !clonedSubMask.invert : clonedSubMask.invert;
  if (options.renameTo !== undefined) {
    clonedSubMask.name = options.renameTo;
  }
  return clonedSubMask;
}

export function insertMaskContainerAt(
  containers: Array<MaskContainer>,
  container: MaskContainer,
  insertIndex = containers.length,
): Array<MaskContainer> {
  const nextContainers = [...containers];
  const targetIndex = Math.max(0, Math.min(insertIndex, nextContainers.length));
  nextContainers.splice(targetIndex, 0, container);
  return nextContainers;
}

export function insertMaskLikeContainerAt<TContainer>(
  containers: Array<TContainer>,
  container: TContainer,
  insertIndex = containers.length,
): Array<TContainer> {
  const nextContainers = [...containers];
  const targetIndex = Math.max(0, Math.min(insertIndex, nextContainers.length));
  nextContainers.splice(targetIndex, 0, container);
  return nextContainers;
}

export function insertSubMaskAt<TSubMask extends SubMask>(
  subMasks: Array<TSubMask>,
  subMask: TSubMask,
  insertIndex = subMasks.length,
): Array<TSubMask> {
  const nextSubMasks = [...subMasks];
  const targetIndex = Math.max(0, Math.min(insertIndex, nextSubMasks.length));
  nextSubMasks.splice(targetIndex, 0, subMask);
  return nextSubMasks;
}
