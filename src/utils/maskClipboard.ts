import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from './adjustments';

import type { SubMask } from '../components/panel/right/Masks';

export type MaskClipboardIdFactory = () => string;

export interface CloneMaskContainerOptions {
  invert?: boolean;
  renameTo?: string;
  resetAdjustments?: boolean;
}

export interface CloneSubMaskOptions {
  invert?: boolean;
  renameTo?: string;
}

export function cloneMaskContainerForPaste(
  container: MaskContainer,
  createId: MaskClipboardIdFactory,
  options: CloneMaskContainerOptions = {},
): MaskContainer {
  const clonedContainer = structuredClone(container);
  clonedContainer.id = createId();
  clonedContainer.invert = options.invert ? !clonedContainer.invert : clonedContainer.invert;
  clonedContainer.name = options.renameTo ?? clonedContainer.name;
  clonedContainer.subMasks = clonedContainer.subMasks.map((subMask) => ({
    ...subMask,
    id: createId(),
  }));

  if (options.resetAdjustments) {
    clonedContainer.adjustments = structuredClone(INITIAL_MASK_ADJUSTMENTS);
  }

  return clonedContainer;
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

export function insertSubMaskAt(
  subMasks: Array<SubMask>,
  subMask: SubMask,
  insertIndex = subMasks.length,
): Array<SubMask> {
  const nextSubMasks = [...subMasks];
  const targetIndex = Math.max(0, Math.min(insertIndex, nextSubMasks.length));
  nextSubMasks.splice(targetIndex, 0, subMask);
  return nextSubMasks;
}
