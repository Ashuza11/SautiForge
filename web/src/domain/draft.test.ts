import { describe, expect, it } from 'vitest';

import { LocalDraftRepository, emptyBusinessLabels, prefillVerbatim, prepareDraftForSave, scenarioTransactionIntent, webAnnotationDraftSchema, withScenarioTransactionIntent, type DraftStorage } from './draft';

const manifestHash = 'a'.repeat(64);
const recordingId = 'de0a9676-92cc-4b18-997a-3fafce18b700';

describe('local web annotation drafts', () => {
  it('validates, saves, reloads and clears a draft', () => {
    const storage = new MemoryStorage();
    const repository = new LocalDraftRepository(storage);
    const draft = makeDraft();
    expect(repository.save(draft)).toEqual(draft);
    expect(repository.load(manifestHash, recordingId)).toEqual(draft);
    expect(repository.listForDataset({ manifestSha256: manifestHash, records: { recordings: [{ id: recordingId }] } } as never)).toEqual([draft]);
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
    expect(() => webAnnotationDraftSchema.parse({ ...makeDraft(), codeSwitchingStatus: 'yes' })).toThrow();
  });

  it('loads older drafts without inventing a code-switching correction', () => {
    const { codeSwitchingStatus: _removed, ...olderDraft } = makeDraft();
    expect(webAnnotationDraftSchema.parse(olderDraft).codeSwitchingStatus).toBeUndefined();
  });

  it('does not report success when browser storage cannot persist a write', () => {
    const repository = new LocalDraftRepository(new FailingStorage());
    expect(() => repository.save(makeDraft())).toThrow(/could not be written/);
    const silentRepository = new LocalDraftRepository(new SilentStorage());
    expect(() => silentRepository.save(makeDraft())).toThrow(/not readable after saving/);
  });

  it('marks a completed verbatim draft transcribed without overriding later review states', () => {
    expect(prepareDraftForSave({ ...makeDraft(), annotationStatus: 'needs_transcription' }, new Date('2026-10-15T11:00:00.000Z'))).toMatchObject({
      annotationStatus: 'transcribed',
      updatedAt: '2026-10-15T11:00:00.000Z',
    });
    expect(prepareDraftForSave({ ...makeDraft(), annotationStatus: 'needs_review' }).annotationStatus).toBe('needs_review');
    expect(prepareDraftForSave({ ...makeDraft(), verbatimText: '', annotationStatus: 'needs_transcription' }).annotationStatus).toBe('needs_transcription');
  });

  it('prefills supported scenario intent without replacing a human label', () => {
    const empty = emptyBusinessLabels();
    expect(withScenarioTransactionIntent(empty, 'record_sale').transactionIntent).toBe('record_sale');
    expect(withScenarioTransactionIntent({ ...empty, transactionIntent: 'other' }, 'record_sale').transactionIntent).toBe('other');
    expect(scenarioTransactionIntent('custom_research_intent')).toBeNull();
  });

  it('prefills empty verbatim text from the example without replacing a transcript', () => {
    expect(prefillVerbatim('', 'Example phrase')).toBe('Example phrase');
    expect(prefillVerbatim(null, 'Example phrase')).toBe('Example phrase');
    expect(prefillVerbatim('Actual spoken words', 'Example phrase')).toBe('Actual spoken words');
    expect(prefillVerbatim('', null)).toBe('');
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
