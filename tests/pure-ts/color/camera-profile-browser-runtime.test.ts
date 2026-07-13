import { describe, expect, test } from 'bun:test';
import type { CameraProfileBrowserEntry } from '../../../src/schemas/color/cameraProfileBrowserSchemas';
import {
  applyCameraProfileIdentity,
  groupCameraProfiles,
  queryCameraProfiles,
} from '../../../src/utils/color/profile/cameraProfileBrowserRuntime';

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const entries = [
  {
    cameraModel: 'Sony ILCE-7RM4',
    compatible: true,
    creativeAmountSupported: false,
    contentSha256: hash('a'),
    displayName: 'Neutral',
    favorite: false,
    id: `dcp:${'a'.repeat(64)}`,
    lastUsedEpochMs: 4,
    source: 'user',
  },
  {
    cameraModel: 'Nikon Z 8',
    compatible: false,
    creativeAmountSupported: true,
    contentSha256: hash('b'),
    displayName: 'Portrait',
    favorite: true,
    id: `dcp:${'b'.repeat(64)}`,
    lastUsedEpochMs: null,
    source: 'open',
  },
] satisfies Array<CameraProfileBrowserEntry>;

describe('camera profile browser semantics', () => {
  test('searches camera identity, filters incompatible entries, and sorts favorites first', () => {
    expect(
      queryCameraProfiles(entries, { compatibleOnly: false, search: '' }).map((entry) => entry.displayName),
    ).toEqual(['Portrait', 'Neutral']);
    expect(
      queryCameraProfiles(entries, { compatibleOnly: true, search: 'sony ilce 7rm4' }).map(
        (entry) => entry.displayName,
      ),
    ).toEqual(['Neutral']);
  });
  test('groups profiles by provenance source without losing identity', () => {
    const groups = groupCameraProfiles(entries);
    expect(groups.get('user')?.[0]?.contentSha256).toBe(hash('a'));
    expect(groups.get('open')?.[0]?.compatible).toBe(false);
  });
  test('applying a profile changes only profile identity', () => {
    const before = { cameraProfile: 'camera_standard' as const, exposure: 18, temperature: 5100, toneCurve: 'linear' };
    const after = applyCameraProfileIdentity(before, `dcp:${'a'.repeat(64)}`);
    expect(after).toEqual({ ...before, cameraProfile: `dcp:${'a'.repeat(64)}` });
    expect(before.cameraProfile).toBe('camera_standard');
  });
});
