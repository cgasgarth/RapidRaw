import { describe, expect, test } from 'bun:test';

import { findForbiddenStartupDependency } from '../../../scripts/ci/startupEntryDependencyGuard';

describe('startup entry dependency guard', () => {
  test('ignores dependency-like text in an opaque Vite content hash', () => {
    expect(
      findForbiddenStartupDependency('index.html', {
        file: 'assets/index-ZoDX18UC.js',
        name: 'index',
        src: 'index.html',
      }),
    ).toBeUndefined();
  });

  test.each([
    ['_zod.js', 'zod'],
    ['vendor-react.js', 'react'],
    ['vendor-react-dom.js', 'react'],
  ] as const)('rejects a genuine %s static manifest identity', (manifestKey, dependency) => {
    expect(findForbiddenStartupDependency(manifestKey, { file: `assets/${manifestKey}`, name: manifestKey })).toBe(
      dependency,
    );
  });
});
