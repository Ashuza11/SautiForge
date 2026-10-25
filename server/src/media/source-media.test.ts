import { describe, expect, it } from 'vitest';

import { MAX_SOURCE_MEDIA_BYTES, sourceMediaUploadDraftSchema } from './source-media';

const validDraft = {
  fileName: 'authorized-master.opus',
  contentType: 'audio/ogg',
  sizeBytes: 4096,
  sha256: 'A'.repeat(64),
  createdBy: 'ADMIN-01',
};

describe('source media contracts', () => {
  it('normalizes a hexadecimal checksum and media type', () => {
    expect(sourceMediaUploadDraftSchema.parse(validDraft)).toMatchObject({
      contentType: 'audio/ogg',
      sha256: 'a'.repeat(64),
    });
  });

  it('accepts only bounded audio or video masters with safe display filenames', () => {
    expect(() => sourceMediaUploadDraftSchema.parse({ ...validDraft, contentType: 'application/zip' })).toThrow(/audio or video/i);
    expect(() => sourceMediaUploadDraftSchema.parse({ ...validDraft, fileName: '../private.opus' })).toThrow(/filename/i);
    expect(() => sourceMediaUploadDraftSchema.parse({ ...validDraft, sizeBytes: MAX_SOURCE_MEDIA_BYTES + 1 })).toThrow();
  });

  it('requires an exact SHA-256 digest and a pseudonymous administrator code', () => {
    expect(() => sourceMediaUploadDraftSchema.parse({ ...validDraft, sha256: 'abcd' })).toThrow(/SHA-256/i);
    expect(() => sourceMediaUploadDraftSchema.parse({ ...validDraft, createdBy: 'Admin Person' })).toThrow(/pseudonymous/i);
  });
});
