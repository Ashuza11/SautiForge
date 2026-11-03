import { describe, expect, it } from 'vitest';

import { editReview, newReview, parseManifest, type SegmentationManifest } from './segmentation';
import { LocalSegmentationDraftRepository, type DraftStorage } from './segmentation-draft';

function manifest(): SegmentationManifest {
  return parseManifest(JSON.stringify({
    schema: 'sautiforge.segmentation/1', createdAt: '2026-11-03T10:00:00Z',
    source: { fileName: 'a.mp4', sha256: 'b'.repeat(64), durationMs: 30_000, workingAudio: 'audio_16k.wav', workingSampleRate: 16_000 },
    processing: {}, speechSpans: [],
    clips: [{ id: 'c001', startMs: 1_000, endMs: 6_000, durationMs: 5_000, speechStartMs: 1_100, speechEndMs: 5_900, spanCount: 1, cutCandidatesMs: [], flags: [], metrics: {}, review: newReview() }],
  }));
}

class MemoryStorage implements DraftStorage {
  values = new Map<string, string>();
  ignoreWrites = false;
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error('quota'); if (!this.ignoreWrites) this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('local segmentation drafts', () => {
  it('saves, reloads and clears a review keyed by source hash', () => {
    const storage = new MemoryStorage();
    const repo = new LocalSegmentationDraftRepository(storage);
    const edited = editReview(manifest(), 'c001', { transcript: 'mbote' });
    repo.save(edited);
    expect(repo.load('b'.repeat(64))).toEqual(edited);
    expect(repo.load('c'.repeat(64))).toBeNull();
    repo.clear('b'.repeat(64));
    expect(repo.load('b'.repeat(64))).toBeNull();
  });

  it('does not report success when storage fails or silently drops the write', () => {
    const storage = new MemoryStorage();
    const repo = new LocalSegmentationDraftRepository(storage);
    storage.failWrites = true;
    expect(() => repo.save(manifest())).toThrow(/could not be written/);
    storage.failWrites = false;
    storage.ignoreWrites = true;
    expect(() => repo.save(manifest())).toThrow(/not readable after saving/);
  });

  it('reports a corrupt draft instead of ignoring it', () => {
    const storage = new MemoryStorage();
    storage.values.set(`sautiforge.segmentation.draft.${'b'.repeat(64)}`, '{broken');
    expect(() => new LocalSegmentationDraftRepository(storage).load('b'.repeat(64))).toThrow(/invalid/);
  });
});
