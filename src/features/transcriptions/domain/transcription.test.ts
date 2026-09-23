import { describe, expect, it } from 'vitest';

import { transcriptionDraftSchema, transcriptionSchema } from './transcription';

describe('transcription validation', () => {
  it('keeps verbatim and normalized text independent and permits an empty optional transcript', () => {
    const draft = transcriptionDraftSchema.parse({ verbatimText: 'Nimeuzisha unités mbili', normalizedText: 'Nimeuza vipande viwili', languageTags: ['kingwana'], notes: null, createdBy: 'researcher' });
    expect(draft.verbatimText).not.toBe(draft.normalizedText);
    expect(transcriptionDraftSchema.safeParse({ verbatimText: null, normalizedText: null, languageTags: [], notes: null, createdBy: null }).success).toBe(true);
  });

  it('records revision provenance and rejects revision zero', () => {
    const base = { id: '0d050af7-474d-4ac7-b1e2-f9e05ecbdc79', recordingId: 'de0a9676-92cc-4b18-997a-3fafce18b700', verbatimText: 'test', normalizedText: null, languageTags: ['en'], notes: null, source: 'human' as const, supersedesId: null, createdAt: '2026-09-23T08:00:00.000Z', createdBy: null };
    expect(transcriptionSchema.safeParse({ ...base, revisionNumber: 1 }).success).toBe(true);
    expect(transcriptionSchema.safeParse({ ...base, revisionNumber: 0 }).success).toBe(false);
  });
});
