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

export interface SplitSubMaskResult<TContainer extends MaskListContainer> {
  container: TContainer;
  containers: Array<TContainer>;
  subMask: SubMask;
}

export interface MaskListContainer {
  id: string;
  subMasks: Array<SubMask>;
}

const cloneMaskListContainers = <TContainer extends MaskListContainer>(
  containers: Array<TContainer>,
): Array<TContainer> => containers.map((container) => ({ ...container, subMasks: [...container.subMasks] }));

export function reorderMaskListContainers<TContainer extends MaskListContainer>(
  containers: Array<TContainer>,
  activeContainerId: string,
  targetContainerId: string,
): Array<TContainer> | null {
  const oldIndex = containers.findIndex((container) => container.id === activeContainerId);
  const newIndex = containers.findIndex((container) => container.id === targetContainerId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null;

  const nextContainers = [...containers];
  const [movedContainer] = nextContainers.splice(oldIndex, 1);
  if (!movedContainer) return null;
  nextContainers.splice(newIndex, 0, movedContainer);
  return nextContainers;
}

export function splitSubMaskToContainer<TContainer extends MaskListContainer>(
  containers: Array<TContainer>,
  sourceContainerId: string,
  subMaskId: string,
  createContainer: (subMask: SubMask, containerCount: number) => TContainer,
): SplitSubMaskResult<TContainer> | null {
  const nextContainers = cloneMaskListContainers(containers);
  const sourceContainer = nextContainers.find((container) => container.id === sourceContainerId);
  if (!sourceContainer) return null;

  const subMaskIndex = sourceContainer.subMasks.findIndex((subMask) => subMask.id === subMaskId);
  if (subMaskIndex === -1) return null;

  const [movedSubMask] = sourceContainer.subMasks.splice(subMaskIndex, 1);
  if (!movedSubMask) return null;

  const newContainer = createContainer(movedSubMask, nextContainers.length);
  nextContainers.push(newContainer);
  return { container: newContainer, containers: nextContainers, subMask: movedSubMask };
}

export function moveSubMaskBetweenContainers<TContainer extends MaskListContainer>(
  containers: Array<TContainer>,
  sourceContainerId: string,
  targetContainerId: string,
  subMaskId: string,
  targetSubMaskId?: string,
): Array<TContainer> | null {
  const nextContainers = cloneMaskListContainers(containers);
  const sourceContainer = nextContainers.find((container) => container.id === sourceContainerId);
  const targetContainer = nextContainers.find((container) => container.id === targetContainerId);
  if (!sourceContainer || !targetContainer) return null;

  const sourceSubMaskIndex = sourceContainer.subMasks.findIndex((subMask) => subMask.id === subMaskId);
  if (sourceSubMaskIndex === -1) return null;

  const [movedSubMask] = sourceContainer.subMasks.splice(sourceSubMaskIndex, 1);
  if (!movedSubMask) return null;

  const insertContainer = sourceContainerId === targetContainerId ? sourceContainer : targetContainer;
  const targetSubMaskIndex =
    targetSubMaskId === undefined
      ? -1
      : insertContainer.subMasks.findIndex((subMask) => subMask.id === targetSubMaskId);
  const insertIndex = targetSubMaskIndex >= 0 ? targetSubMaskIndex : insertContainer.subMasks.length;
  insertContainer.subMasks.splice(insertIndex, 0, movedSubMask);
  return nextContainers;
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
