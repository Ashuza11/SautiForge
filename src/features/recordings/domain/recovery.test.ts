import { describe, expect, it } from 'vitest';

import { classifyRecordingFiles } from './recovery';

describe('recording storage recovery', () => {
  it('separates verified, missing, empty, and orphaned files', () => {
    const result = classifyRecordingFiles(
      ['recordings/p/ok.m4a', 'recordings/p/empty.m4a', 'recordings/p/missing.m4a'],
      [{ path: 'recordings/p/ok.m4a', size: 10 }, { path: 'recordings/p/empty.m4a', size: 0 }, { path: 'recordings/p/orphan.m4a', size: 12 }],
    );
    expect(result.verifiedFiles).toBe(1);
    expect(result.missingPaths).toEqual(['recordings/p/empty.m4a', 'recordings/p/missing.m4a']);
    expect(result.quarantinedPaths).toEqual(['recordings/p/empty.m4a', 'recordings/p/orphan.m4a']);
  });
});
