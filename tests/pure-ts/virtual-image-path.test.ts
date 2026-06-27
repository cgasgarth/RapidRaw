import { expect, test } from 'bun:test';

import {
  parseVirtualImagePath,
  serializeVirtualImagePath,
  VIRTUAL_COPY_SUFFIX,
} from '../../src/utils/virtualImagePath.ts';

test('parses a virtual copy path into base path and copy id', () => {
  expect(parseVirtualImagePath('/shoot/DSC_0001.NEF?vc=vc-dsc-0001-edit')).toEqual({
    path: '/shoot/DSC_0001.NEF',
    virtualCopyId: 'vc-dsc-0001-edit',
  });
});

test('preserves the current ?vc= serialized form when rebuilding a path', () => {
  expect(serializeVirtualImagePath('/shoot/DSC_0001.NEF', 'vc-dsc-0001-edit')).toBe(
    `/shoot/DSC_0001.NEF${VIRTUAL_COPY_SUFFIX}vc-dsc-0001-edit`,
  );
});

test('round-trips a path without a virtual copy suffix', () => {
  expect(parseVirtualImagePath('/shoot/DSC_0001.NEF')).toEqual({
    path: '/shoot/DSC_0001.NEF',
    virtualCopyId: null,
  });
  expect(serializeVirtualImagePath('/shoot/DSC_0001.NEF', null)).toBe('/shoot/DSC_0001.NEF');
});

test('matches the current split behavior for repeated suffix markers', () => {
  expect(parseVirtualImagePath('/shoot/DSC_0001.NEF?vc=one?vc=two')).toEqual({
    path: '/shoot/DSC_0001.NEF',
    virtualCopyId: 'one',
  });
});
