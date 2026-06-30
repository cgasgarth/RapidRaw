import { expect, test } from 'bun:test';
import type { LibraryRelinkIdentity } from '../../src/schemas/libraryRelinkSchemas.ts';
import type { LibrarySessionSet } from '../../src/schemas/librarySessionSchemas.ts';
import {
  applyLibraryRelinkToRuntimeState,
  applyLibraryRelinkToSessionSet,
  planLibraryFolderRelink,
  planLibraryRelink,
  rewriteLibraryRelinkPath,
  scoreRelinkCandidate,
} from '../../src/utils/libraryRelinkIdentity.ts';

const hash = (suffix: string) => `sha256:${suffix.padStart(64, '0')}`;

const missingRaw: LibraryRelinkIdentity = {
  byteLength: 42_000_000,
  cameraMake: 'Sony',
  cameraModel: 'ILCE-7CR',
  captureTimestamp: '2026-06-01T18:20:30.000Z',
  contentHash: hash('a'),
  lensModel: 'FE 35mm F1.4 GM',
  path: '/Volumes/card/DCIM/100MSDCF/DSC00001.ARW',
};

const baseSessionSet: LibrarySessionSet = {
  activeSessionId: 'session-1',
  sessions: [
    {
      activeAlbumId: null,
      activeAssetPath: '/Volumes/card/DCIM/100MSDCF/DSC00001.ARW',
      activeFolderPath: '/Volumes/card/DCIM/100MSDCF',
      createdAt: '2026-06-01T18:00:00.000Z',
      exportRecipeIds: [],
      filters: { colorLabels: [], minimumRating: 0, rawStatus: 'all', tags: [], text: '' },
      id: 'session-1',
      importPresetId: null,
      kind: 'editing',
      lastOpenedAt: '2026-06-01T18:30:00.000Z',
      name: 'Alaska selects',
      notes: null,
      recentAssetPaths: ['/Volumes/card/DCIM/100MSDCF/DSC00001.ARW', '/Volumes/card/DCIM/100MSDCF/DSC00002.ARW'],
      rootPaths: ['/Volumes/card/DCIM'],
      selectedAssetPaths: ['/Volumes/card/DCIM/100MSDCF/DSC00001.ARW'],
      smartAlbumIds: [],
      sort: { key: 'name', order: 'asc' },
      stateVersion: 1,
      updatedAt: '2026-06-01T18:30:00.000Z',
      viewMode: 'grid',
      workflowStage: 'edit',
    },
  ],
};

test('selects a moved original when hash and metadata verify identity', () => {
  const plan = planLibraryRelink({
    missingIdentity: missingRaw,
    candidateIdentities: [
      { ...missingRaw, contentHash: hash('b'), path: '/archive/rejects/DSC09999.ARW' },
      { ...missingRaw, path: '/Volumes/archive/Alaska/DSC00001.ARW' },
    ],
  });

  expect(plan.status).toBe('matched');
  expect(plan.selectedCandidatePath).toBe('/Volumes/archive/Alaska/DSC00001.ARW');
  expect(plan.candidates[0]?.decision).toBe('verified');
});

test('requires review when two candidates have equivalent identity evidence', () => {
  const plan = planLibraryRelink({
    missingIdentity: { ...missingRaw, contentHash: null },
    candidateIdentities: [
      { ...missingRaw, contentHash: null, path: '/disk-a/DSC00001.ARW' },
      { ...missingRaw, contentHash: null, path: '/disk-b/DSC00001.ARW' },
    ],
  });

  expect(plan.status).toBe('ambiguous');
  expect(plan.selectedCandidatePath).toBeNull();
  expect(plan.candidates.every((candidate) => candidate.decision === 'possible')).toBe(true);
});

test('rejects candidates with a conflicting content hash', () => {
  const result = scoreRelinkCandidate(missingRaw, {
    ...missingRaw,
    contentHash: hash('f'),
    path: '/wrong/DSC00001.ARW',
  });

  expect(result.decision).toBe('rejected');
  expect(result.evidence).toContainEqual({ kind: 'content_hash', status: 'mismatch', weight: -100 });
});

test('applies a verified file relink to active, recent, and selected session paths', () => {
  const plan = planLibraryRelink({
    missingIdentity: missingRaw,
    candidateIdentities: [{ ...missingRaw, path: '/Volumes/archive/Alaska/DSC00001.ARW' }],
  });

  const updated = applyLibraryRelinkToSessionSet({
    fromPath: missingRaw.path,
    plan,
    sessionSet: baseSessionSet,
  });

  const [session] = updated.sessions;
  expect(session?.activeAssetPath).toBe('/Volumes/archive/Alaska/DSC00001.ARW');
  expect(session?.selectedAssetPaths).toEqual(['/Volumes/archive/Alaska/DSC00001.ARW']);
  expect(session?.recentAssetPaths).toEqual([
    '/Volumes/archive/Alaska/DSC00001.ARW',
    '/Volumes/card/DCIM/100MSDCF/DSC00002.ARW',
  ]);
});

test('applies a verified file relink to runtime state and virtual copy paths', () => {
  const plan = planLibraryRelink({
    missingIdentity: missingRaw,
    candidateIdentities: [{ ...missingRaw, path: '/Volumes/archive/Alaska/DSC00001.ARW' }],
  });

  const updated = applyLibraryRelinkToRuntimeState(
    {
      currentFolderPath: '/Volumes/card/DCIM/100MSDCF',
      imageList: [
        {
          exif: null,
          is_edited: true,
          is_virtual_copy: false,
          modified: 1,
          path: '/Volumes/card/DCIM/100MSDCF/DSC00001.ARW',
          rating: 5,
          tags: ['select'],
        },
        {
          exif: null,
          is_edited: true,
          is_virtual_copy: true,
          modified: 1,
          path: '/Volumes/card/DCIM/100MSDCF/DSC00001.ARW?vc=abc123',
          rating: 4,
          tags: ['copy'],
        },
      ],
      imageRatings: {
        '/Volumes/card/DCIM/100MSDCF/DSC00001.ARW': 5,
        '/Volumes/card/DCIM/100MSDCF/DSC00001.ARW?vc=abc123': 4,
      },
      libraryActivePath: '/Volumes/card/DCIM/100MSDCF/DSC00001.ARW',
      multiSelectedPaths: ['/Volumes/card/DCIM/100MSDCF/DSC00001.ARW?vc=abc123'],
      rootPaths: ['/Volumes/card/DCIM'],
      selectionAnchorPath: '/Volumes/card/DCIM/100MSDCF/DSC00001.ARW',
    },
    missingRaw.path,
    plan,
  );

  expect(updated.imageList.map((image) => image.path)).toEqual([
    '/Volumes/archive/Alaska/DSC00001.ARW',
    '/Volumes/archive/Alaska/DSC00001.ARW?vc=abc123',
  ]);
  expect(updated.imageRatings).toEqual({
    '/Volumes/archive/Alaska/DSC00001.ARW': 5,
    '/Volumes/archive/Alaska/DSC00001.ARW?vc=abc123': 4,
  });
  expect(updated.libraryActivePath).toBe('/Volumes/archive/Alaska/DSC00001.ARW');
  expect(updated.multiSelectedPaths).toEqual(['/Volumes/archive/Alaska/DSC00001.ARW?vc=abc123']);
  expect(updated.selectionAnchorPath).toBe('/Volumes/archive/Alaska/DSC00001.ARW');
});

test('applies a verified folder relink to roots and nested session paths', () => {
  const plan = planLibraryRelink({
    missingIdentity: { ...missingRaw, path: '/Volumes/card/DCIM' },
    candidateIdentities: [{ ...missingRaw, path: '/Volumes/archive/Alaska/DCIM' }],
  });

  const updated = applyLibraryRelinkToSessionSet({
    fromPath: '/Volumes/card/DCIM',
    plan,
    sessionSet: baseSessionSet,
  });

  const [session] = updated.sessions;
  expect(session?.rootPaths).toEqual(['/Volumes/archive/Alaska/DCIM']);
  expect(session?.activeFolderPath).toBe('/Volumes/archive/Alaska/DCIM/100MSDCF');
  expect(session?.recentAssetPaths).toEqual([
    '/Volumes/archive/Alaska/DCIM/100MSDCF/DSC00001.ARW',
    '/Volumes/archive/Alaska/DCIM/100MSDCF/DSC00002.ARW',
  ]);
});

test('plans a same-structure folder relink when all child identities verify', () => {
  const secondMissing = {
    ...missingRaw,
    contentHash: hash('b'),
    path: '/Volumes/card/DCIM/100MSDCF/DSC00002.ARW',
  };

  const plan = planLibraryFolderRelink({
    fromRootPath: '/Volumes/card/DCIM',
    toRootPath: '/Volumes/archive/Alaska/DCIM',
    missingIdentities: [missingRaw, secondMissing],
    candidateIdentities: [
      { ...missingRaw, path: '/Volumes/archive/Alaska/DCIM/100MSDCF/DSC00001.ARW' },
      { ...secondMissing, path: '/Volumes/archive/Alaska/DCIM/100MSDCF/DSC00002.ARW' },
    ],
  });

  expect(plan.status).toBe('matched');
  expect(plan.matchedCount).toBe(2);
  expect(plan.relinkPlan?.selectedCandidatePath).toBe('/Volumes/archive/Alaska/DCIM');
});

test('rejects a folder relink when any expected child is missing or mismatched', () => {
  const plan = planLibraryFolderRelink({
    fromRootPath: '/Volumes/card/DCIM',
    toRootPath: '/Volumes/archive/Alaska/DCIM',
    missingIdentities: [missingRaw],
    candidateIdentities: [],
  });

  expect(plan.status).toBe('rejected');
  expect(plan.rejectedCount).toBe(1);
  expect(plan.relinkPlan).toBeNull();
});

test('rewrites nested folder paths and virtual copy suffixes', () => {
  expect(
    rewriteLibraryRelinkPath(
      '/Volumes/card/DCIM/100MSDCF/DSC00001.ARW?vc=abc123',
      '/Volumes/card/DCIM',
      '/Volumes/archive/Alaska/DCIM',
    ),
  ).toBe('/Volumes/archive/Alaska/DCIM/100MSDCF/DSC00001.ARW?vc=abc123');
});

test('does not apply ambiguous relink plans to sessions', () => {
  const plan = planLibraryRelink({
    missingIdentity: { ...missingRaw, contentHash: null },
    candidateIdentities: [
      { ...missingRaw, contentHash: null, path: '/disk-a/DSC00001.ARW' },
      { ...missingRaw, contentHash: null, path: '/disk-b/DSC00001.ARW' },
    ],
  });

  expect(() =>
    applyLibraryRelinkToSessionSet({
      fromPath: missingRaw.path,
      plan,
      sessionSet: baseSessionSet,
    }),
  ).toThrow('Library relink requires one verified matched candidate.');
});
