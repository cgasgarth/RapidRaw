import type { SubMask } from '../components/panel/right/layers/Masks';
import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from './adjustments';

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

export interface MaskLikeClipboardActionsOptions<TContainer extends MaskLikeContainer> {
  cloneContainerForDuplicate: (container: TContainer, options: { invert?: boolean; rename?: boolean }) => TContainer;
  cloneContainerForInvertedSubMask: (container: TContainer) => TContainer;
  cloneContainerForPaste: (container: TContainer) => TContainer;
  cloneSubMaskForDuplicate: (subMask: SubMask, options: { invert?: boolean; rename?: boolean }) => SubMask;
  cloneSubMaskForPaste: (subMask: SubMask) => SubMask;
  containers: Array<TContainer>;
  copiedContainer: TContainer | null | undefined;
  copiedSubMask: SubMask | null | undefined;
  insertContainer: (container: TContainer, insertIndex?: number) => void;
  insertSubMask: (containerId: string, subMask: SubMask, insertIndex?: number) => void;
  invertedContainerName: (container: TContainer) => string;
  invertedSubMaskContainerName: (subMask: SubMask) => string;
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

export function createInvertedSubMaskContainer<TContainer extends MaskLikeContainer>({
  cloneContainer,
  cloneSubMask,
  invertedName,
  parentContainer,
  subMask,
}: {
  cloneContainer: (container: TContainer) => TContainer;
  cloneSubMask: (subMask: SubMask) => SubMask;
  invertedName: string;
  parentContainer: TContainer;
  subMask: SubMask;
}): TContainer {
  const newContainer = cloneContainer(parentContainer);
  newContainer.name = invertedName;
  newContainer.subMasks = [cloneSubMask(subMask)];
  newContainer.invert = false;
  return newContainer;
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

export function getMaskLikeInsertAfterIndex(
  containers: Array<MaskListContainer>,
  containerId: string,
): number | undefined {
  const containerIndex = containers.findIndex((container) => container.id === containerId);
  return containerIndex >= 0 ? containerIndex + 1 : undefined;
}

export function createMaskLikeClipboardActions<TContainer extends MaskLikeContainer>({
  cloneContainerForDuplicate,
  cloneContainerForInvertedSubMask,
  cloneContainerForPaste,
  cloneSubMaskForDuplicate,
  cloneSubMaskForPaste,
  containers,
  copiedContainer,
  copiedSubMask,
  insertContainer,
  insertSubMask,
  invertedContainerName,
  invertedSubMaskContainerName,
}: MaskLikeClipboardActionsOptions<TContainer>) {
  const duplicateContainer = (container: TContainer) => {
    insertContainer(
      cloneContainerForDuplicate(container, { rename: true }),
      getMaskLikeInsertAfterIndex(containers, container.id),
    );
  };

  const duplicateAndInvertContainer = (container: TContainer) => {
    const duplicatedContainer = cloneContainerForDuplicate(container, { invert: true, rename: false });
    duplicatedContainer.name = invertedContainerName(container);

    insertContainer(duplicatedContainer, getMaskLikeInsertAfterIndex(containers, container.id));
  };

  const pasteContainer = (insertAfterContainerId?: string) => {
    if (!copiedContainer) return;

    const containerIndex = insertAfterContainerId
      ? containers.findIndex((container) => container.id === insertAfterContainerId)
      : -1;
    insertContainer(cloneContainerForPaste(copiedContainer), containerIndex >= 0 ? containerIndex + 1 : undefined);
  };

  const duplicateSubMask = (containerId: string, subMask: SubMask, insertIndex?: number) => {
    insertSubMask(containerId, cloneSubMaskForDuplicate(subMask, { rename: true }), insertIndex);
  };

  const duplicateAndInvertSubMask = (containerId: string, subMask: SubMask) => {
    const parentContainer = containers.find((container) => container.id === containerId);
    if (!parentContainer) return;

    const newContainer = createInvertedSubMaskContainer({
      cloneContainer: cloneContainerForInvertedSubMask,
      cloneSubMask: (sourceSubMask) => cloneSubMaskForDuplicate(sourceSubMask, { invert: true, rename: false }),
      invertedName: invertedSubMaskContainerName(subMask),
      parentContainer,
      subMask,
    });

    insertContainer(newContainer, getMaskLikeInsertAfterIndex(containers, containerId));
  };

  const pasteSubMask = (containerId: string, insertIndex?: number) => {
    if (!copiedSubMask) return;

    insertSubMask(containerId, cloneSubMaskForPaste(copiedSubMask), insertIndex);
  };

  return {
    duplicateAndInvertContainer,
    duplicateAndInvertSubMask,
    duplicateContainer,
    duplicateSubMask,
    pasteContainer,
    pasteSubMask,
  };
}
