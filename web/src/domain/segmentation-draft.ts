import { parseManifest, serializeManifest, type SegmentationManifest } from './segmentation';

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const keyFor = (sourceSha256: string) => `sautiforge.segmentation.draft.${sourceSha256}`;

/** Keeps the in-progress review in this browser, keyed by the source media hash. */
export class LocalSegmentationDraftRepository {
  constructor(private readonly storage: DraftStorage) {}

  load(sourceSha256: string): SegmentationManifest | null {
    let value: string | null;
    try { value = this.storage.getItem(keyFor(sourceSha256)); }
    catch { throw new Error('Browser storage is unavailable, so the review draft cannot be restored.'); }
    if (!value) return null;
    try {
      const manifest = parseManifest(value);
      return manifest.source.sha256 === sourceSha256 ? manifest : null;
    } catch {
      throw new Error('The saved review draft in this browser is invalid. Reset it to start again from the opened file.');
    }
  }

  /** Writes and reads back; only a verified write counts as saved. */
  save(manifest: SegmentationManifest): void {
    const text = serializeManifest(manifest);
    try { this.storage.setItem(keyFor(manifest.source.sha256), text); }
    catch { throw new Error('The review could not be written to browser storage. Download the manifest now to avoid losing work.'); }
    let readBack: string | null = null;
    try { readBack = this.storage.getItem(keyFor(manifest.source.sha256)); } catch { /* reported below */ }
    if (readBack !== text) throw new Error('The review was not readable after saving. It is not confirmed as saved; download the manifest.');
  }

  clear(sourceSha256: string): void {
    try { this.storage.removeItem(keyFor(sourceSha256)); }
    catch { throw new Error('The saved review draft could not be removed.'); }
  }
}
