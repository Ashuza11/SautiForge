import { describe, expect, it } from 'vitest';

import { LocalDraftRepository, emptyBusinessLabels, webAnnotationDraftSchema, type DraftStorage } from './draft';

const manifestHash = 'a'.repeat(64);
const recordingId = 'de0a9676-92cc-4b18-997a-3fafce18b700';

describe('local web annotation drafts', () => {
  it('validates, saves, reloads and clears a draft', () => {
    const storage = new MemoryStorage();
    const repository = new LocalDraftRepository(storage);
    const draft = makeDraft();
    expect(repository.save(draft)).toEqual(draft);
    expect(repository.load(manifestHash, recordingId)).toEqual(draft);
    repository.clear(manifestHash, recordingId);
    expect(repository.load(manifestHash, recordingId)).toBeNull();
  });

  it('rejects malformed or mismatched persisted data', () => {
    const storage = new MemoryStorage();
    const repository = new LocalDraftRepository(storage);
    repository.save(makeDraft());
    storage.replaceOnlyValue(JSON.stringify({ ...makeDraft(), recordingId: 'not-a-uuid' }));
    expect(() => repository.load(manifestHash, recordingId)).toThrow(/invalid annotation draft/);
    expect(() => webAnnotationDraftSchema.parse({ ...makeDraft(), annotationStatus: 'complete' })).toThrow();
  });

  it('does not report success when browser storage cannot persist a write', () => {
    const repository = new LocalDraftRepository(new FailingStorage());
    expect(() => repository.save(makeDraft())).toThrow(/could not be written/);
    const silentRepository = new LocalDraftRepository(new SilentStorage());
    expect(() => silentRepository.save(makeDraft())).toThrow(/not readable after saving/);
  });
});

function makeDraft() {
  return webAnnotationDraftSchema.parse({
    schemaVersion: 1,
    sourceManifestSha256: manifestHash,
    recordingId,
    verbatimText: 'Nimeuza sukari.',
    normalizedText: '',
    scenarioContext: 'Recording a sale',
    elicitationPromptContext: 'Leo nimeuza sukari.',
    languageTags: ['Kingwana'],
    notes: '',
    createdBy: 'ANNOTATOR-01',
    annotationStatus: 'transcribed',
    businessLabels: { ...emptyBusinessLabels(), transactionIntent: 'record_sale', currency: 'CDF' },
    updatedAt: '2026-10-15T10:00:00.000Z',
  });
}

class MemoryStorage implements DraftStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  replaceOnlyValue(value: string) {
    const key = [...this.values.keys()][0];
    if (key) this.values.set(key, value);
  }
}

class FailingStorage implements DraftStorage {
  getItem() { return null; }
  setItem() { throw new Error('quota'); }
  removeItem() {}
}

class SilentStorage implements DraftStorage {
  getItem() { return null; }
  setItem() {}
  removeItem() {}
}
