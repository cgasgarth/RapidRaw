import { expect, test } from 'bun:test';

import {
  moveSubMaskBetweenContainers,
  reorderMaskListContainers,
  splitSubMaskToContainer,
} from '../../src/utils/maskClipboard.ts';

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
