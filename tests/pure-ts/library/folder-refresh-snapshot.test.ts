import { expect, test } from 'bun:test';
import {
  type FolderRefreshSnapshot,
  hasFolderRefreshSnapshotChanged,
} from '../../../src/hooks/library/folderRefreshSnapshot.ts';

const snapshot = (overrides: Partial<FolderRefreshSnapshot>): FolderRefreshSnapshot => ({
  fingerprint: 'fingerprint-a',
  itemCount: 1,
  path: '/photos/session',
  recursive: false,
  ...overrides,
});

test('folder refresh snapshots treat added or removed files as a change', () => {
  const baseline = snapshot({});
  expect(hasFolderRefreshSnapshotChanged(null, baseline)).toBe(true);
  expect(hasFolderRefreshSnapshotChanged(baseline, snapshot({ itemCount: 2, fingerprint: 'fingerprint-b' }))).toBe(
    true,
  );
  expect(hasFolderRefreshSnapshotChanged(baseline, snapshot({ itemCount: 0, fingerprint: 'fingerprint-c' }))).toBe(
    true,
  );
  expect(hasFolderRefreshSnapshotChanged(baseline, snapshot({ fingerprint: 'fingerprint-a' }))).toBe(false);
});
