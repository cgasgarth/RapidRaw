import { expect, test } from 'bun:test';

import {
  createMaskLikeClipboardActions,
  moveSubMaskBetweenContainers,
  reorderMaskListContainers,
  splitSubMaskToContainer,
} from '../../../src/utils/mask/maskClipboard.ts';

const subMask = (id) => ({ id, invert: false, mode: 'Additive', opacity: 100, type: 'Brush', visible: true });
const container = (id, subMasks) => ({ id, invert: false, name: id, subMasks });

test('reorderMaskListContainers moves an item by target id', () => {
  const result = reorderMaskListContainers([container('a', []), container('b', []), container('c', [])], 'a', 'c');

  expect(result?.map((item) => item.id)).toEqual(['b', 'c', 'a']);
});

test('splitSubMaskToContainer removes a submask and appends a new container', () => {
  const result = splitSubMaskToContainer([container('a', [subMask('s1'), subMask('s2')])], 'a', 's1', (moved) =>
    container('b', [moved]),
  );

  expect(result?.containers.map((item) => item.id)).toEqual(['a', 'b']);
  expect(result?.containers[0].subMasks.map((item) => item.id)).toEqual(['s2']);
  expect(result?.container.subMasks.map((item) => item.id)).toEqual(['s1']);
});

test('moveSubMaskBetweenContainers handles same-container reorder and cross-container move', () => {
  const sameContainer = moveSubMaskBetweenContainers(
    [container('a', [subMask('s1'), subMask('s2')])],
    'a',
    'a',
    's2',
    's1',
  );
  expect(sameContainer?.[0].subMasks.map((item) => item.id)).toEqual(['s2', 's1']);

  const crossContainer = moveSubMaskBetweenContainers(
    [container('a', [subMask('s1')]), container('b', [subMask('s2')])],
    'a',
    'b',
    's1',
    's2',
  );
  expect(crossContainer?.map((item) => item.subMasks.map((mask) => mask.id))).toEqual([[], ['s1', 's2']]);
});

test('createMaskLikeClipboardActions shares duplicate, invert, and paste orchestration', () => {
  let containers = [container('a', [subMask('s1')]), container('b', [])];
  const insertedContainers = [];
  const insertedSubMasks = [];
  const actions = createMaskLikeClipboardActions({
    cloneContainerForDuplicate: (source, options) => ({
      ...source,
      id: `${source.id}-copy`,
      invert: options.invert ? !source.invert : source.invert,
      name: options.rename === false ? source.name : `${source.name} Copy`,
      subMasks: source.subMasks.map((mask) => ({ ...mask, id: `${mask.id}-copy` })),
    }),
    cloneContainerForInvertedSubMask: (source) => ({ ...source, id: `${source.id}-submask-copy`, subMasks: [] }),
    cloneContainerForPaste: (source) => ({ ...source, id: `${source.id}-paste` }),
    cloneSubMaskForDuplicate: (source, options) => ({
      ...source,
      id: `${source.id}-copy`,
      invert: options.invert ? !source.invert : source.invert,
      name: options.rename === false ? source.name : `${source.name ?? source.id} Copy`,
    }),
    cloneSubMaskForPaste: (source) => ({ ...source, id: `${source.id}-paste` }),
    containers,
    copiedContainer: container('clip', []),
    copiedSubMask: subMask('clip-sub'),
    insertContainer: (nextContainer, insertIndex) => {
      insertedContainers.push({ container: nextContainer, insertIndex });
      containers = [...containers.slice(0, insertIndex), nextContainer, ...containers.slice(insertIndex)];
    },
    insertSubMask: (containerId, nextSubMask, insertIndex) => {
      insertedSubMasks.push({ containerId, insertIndex, subMask: nextSubMask });
    },
    invertedContainerName: (source) => `Invert ${source.name}`,
    invertedSubMaskContainerName: (source) => `Invert ${source.id}`,
  });

  actions.duplicateContainer(containers[0]);
  actions.duplicateAndInvertContainer(containers[0]);
  actions.pasteContainer('b');
  actions.duplicateSubMask('a', subMask('s2'), 0);
  actions.duplicateAndInvertSubMask('a', subMask('s3'));
  actions.pasteSubMask('b');

  expect(insertedContainers.map((entry) => [entry.container.id, entry.container.name, entry.insertIndex])).toEqual([
    ['a-copy', 'a Copy', 1],
    ['a-copy', 'Invert a', 1],
    ['clip-paste', 'clip', 2],
    ['a-submask-copy', 'Invert s3', 1],
  ]);
  expect(insertedSubMasks.map((entry) => [entry.containerId, entry.subMask.id, entry.insertIndex])).toEqual([
    ['a', 's2-copy', 0],
    ['b', 'clip-sub-paste', undefined],
  ]);
});
