import { expect, test } from 'bun:test';

import { planLibraryRelink, scoreRelinkCandidate } from '../../src/utils/libraryRelinkIdentity.ts';

import type { LibraryRelinkIdentity } from '../../src/schemas/libraryRelinkSchemas.ts';

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
