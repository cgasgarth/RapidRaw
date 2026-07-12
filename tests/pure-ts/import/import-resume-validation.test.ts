import { describe, expect, test } from 'bun:test';
import { importResumeValidationSchema } from '../../../src/schemas/fileOperationSchemas';

describe('import resume validation schema', () => {
  test('accepts a partial journal validation result', () => {
    const result = importResumeValidationSchema.parse({
      jobId: 'import-123',
      verifiedCompleted: [1],
      resumable: [2, 3],
      invalid: [],
    });

    expect(result.resumable).toEqual([2, 3]);
  });

  test('preserves source revision rejection details', () => {
    const result = importResumeValidationSchema.parse({
      jobId: 'import-123',
      verifiedCompleted: [],
      resumable: [],
      invalid: [
        {
          itemId: 2,
          source: '/tmp/photo.ARW',
          stage: 'verifying',
          error: 'source revision changed since journal creation',
        },
      ],
    });

    expect(result.invalid[0]?.error).toContain('source revision');
  });
});
