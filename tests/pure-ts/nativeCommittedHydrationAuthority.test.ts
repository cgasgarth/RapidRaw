import { describe, expect, test } from 'bun:test';

import { NativeCommittedHydrationAuthority } from '../../src/utils/nativeCommittedHydrationAuthority';

describe('native-committed hydration authority', () => {
  test('isolates exact sessions and evicts the least recently protected session', () => {
    const authority = new NativeCommittedHydrationAuthority(2);
    authority.protect('session-a', 'transaction-a');
    authority.protect('session-b', 'transaction-b');

    expect(authority.isProtected('session-a')).toBe(true);
    expect(authority.isProtected('session-b')).toBe(true);
    expect(authority.isProtected('session-a-successor')).toBe(false);

    authority.protect('session-a', 'transaction-a-new');
    authority.protect('session-c', 'transaction-c');

    expect(authority.isProtected('session-a')).toBe(true);
    expect(authority.isProtected('session-b')).toBe(false);
    expect(authority.isProtected('session-c')).toBe(true);
  });
});
