import { expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditorCollectionsSection from '../../../src/components/panel/editor/EditorCollectionsSection';
import { useLibraryStore } from '../../../src/store/useLibraryStore';

test('renders typed album collections and selects nested albums through keyboard or pointer input', async () => {
  const previous = useLibraryStore.getState();
  const selected: Array<[string, string, string[]]> = [];
  useLibraryStore.setState({
    activeAlbumId: null,
    albumTree: [
      {
        children: [{ id: 'album-1', images: ['/private/alaska.nef'], name: 'Alaska', type: 'album' }],
        id: 'group-1',
        name: 'Trips',
        type: 'group',
      },
    ],
    expandedAlbumGroups: new Set<string>(),
  });

  try {
    const user = userEvent.setup();
    const { container } = render(<EditorCollectionsSection onSelectAlbum={(...args) => selected.push(args)} />);
    const group = container.querySelector<HTMLElement>('[data-album-id="group-1"] [role="button"]');
    if (!group) throw new Error('Expected collection group to render.');
    await act(async () => {
      await user.click(group);
    });
    const album = container.querySelector<HTMLElement>('[data-album-id="album-1"] [role="button"]');
    if (!album) throw new Error('Expected expanded album to render.');
    album.focus();
    await act(async () => {
      await user.keyboard('{Enter}');
    });

    expect(selected).toEqual([['album-1', 'Alaska', ['/private/alaska.nef']]]);
    expect(container.querySelector('[data-album-image-count="true"]')?.textContent).toBe('1');
  } finally {
    await act(async () => {
      useLibraryStore.setState({
        activeAlbumId: previous.activeAlbumId,
        albumTree: previous.albumTree,
        expandedAlbumGroups: previous.expandedAlbumGroups,
      });
    });
  }
});
