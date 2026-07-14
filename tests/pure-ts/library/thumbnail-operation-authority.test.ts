import { describe, expect, test } from 'bun:test';
import {
  isCurrentThumbnailAuthority,
  shouldAcceptThumbnailAuthority,
  thumbnailErrorPayloadSchema,
  thumbnailOperationAuthoritySchema,
  thumbnailProgressPayloadSchema,
} from '../../../src/schemas/thumbnailOperationSchemas';

describe('thumbnail operation authority', () => {
  test('stale generation and same-generation predecessor cannot target the successor', () => {
    const successor = { generation: 7, operationId: 12 };

    expect(isCurrentThumbnailAuthority({ generation: 6, operationId: 99 }, successor)).toBeFalse();
    expect(isCurrentThumbnailAuthority({ generation: 7, operationId: 11 }, successor)).toBeFalse();
    expect(isCurrentThumbnailAuthority(successor, successor)).toBeTrue();
  });

  test('listener admission advances monotonically by generation then operation', () => {
    const current = { generation: 7, operationId: 12 };

    expect(shouldAcceptThumbnailAuthority({ generation: 6, operationId: 100 }, current)).toBeFalse();
    expect(shouldAcceptThumbnailAuthority({ generation: 7, operationId: 11 }, current)).toBeFalse();
    expect(shouldAcceptThumbnailAuthority({ generation: 7, operationId: 12 }, current)).toBeTrue();
    expect(shouldAcceptThumbnailAuthority({ generation: 7, operationId: 13 }, current)).toBeTrue();
    expect(shouldAcceptThumbnailAuthority({ generation: 8, operationId: 1 }, current)).toBeTrue();
  });

  test('unkeyed progress and cancellation authority are rejected at the boundary', () => {
    expect(() => thumbnailProgressPayloadSchema.parse({ current: 1, total: 2 })).toThrow();
    expect(() => thumbnailOperationAuthoritySchema.parse({ generation: 1 })).toThrow();
    expect(() => thumbnailErrorPayloadSchema.parse({ message: 'failed', path: 'a.raw' })).toThrow();
    expect(thumbnailProgressPayloadSchema.parse({ generation: 1, operationId: 2, current: 1, total: 2 })).toMatchObject(
      { generation: 1, operationId: 2, current: 1, total: 2 },
    );
  });
});
