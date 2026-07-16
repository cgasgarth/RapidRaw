import { beforeEach, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import { useLibraryImage } from '../../../src/hooks/library/useLibraryImage';
import { libraryEntityRepository } from '../../../src/library/LibraryEntityRepository';

const renders = new Map<string, number>();
const image = (path: string) => ({
  path,
  rating: 0,
  modified: 1,
  is_edited: false,
  is_virtual_copy: false,
  tags: null,
  exif: null,
});

function Cell({ path }: { path: string }) {
  const entity = useLibraryImage(path);
  renders.set(path, (renders.get(path) ?? 0) + 1);
  return <span>{entity?.rating}</span>;
}

beforeEach(async () => {
  renders.clear();
  libraryEntityRepository.replaceAll([image('/a.raw'), image('/b.raw')]);
  render(
    <>
      <Cell path="/a.raw" />
      <Cell path="/b.raw" />
    </>,
  );
});

test('metadata patch rerenders only the subscribed image cell', async () => {
  const beforeA = renders.get('/a.raw');
  const beforeB = renders.get('/b.raw');
  await act(async () =>
    libraryEntityRepository.patchMany([{ path: '/a.raw', changes: { rating: 5, is_edited: true } }]),
  );
  expect(renders.get('/a.raw')).toBe((beforeA ?? 0) + 1);
  expect(renders.get('/b.raw')).toBe(beforeB);
});
