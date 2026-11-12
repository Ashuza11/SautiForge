import { describe, expect, it } from 'vitest';

import {
  clearContributor, clipLink, parseClipHash, clearDraft, loadContributor, loadDraft, nextSpeed, nicknameProblem, parseBatchHash, progressPercent,
  saveContributor, saveDraft, speedLabel, type StorageLike,
} from './volunteer-view';

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};
const broken: StorageLike = {
  getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); },
};
const id = '00000000-0000-4000-8000-000000000901';

describe('volunteer helpers', () => {
  it('reads only well-formed batch links from the address', () => {
    expect(parseBatchHash(`#/b/${id}.${'a'.repeat(24)}`)).toBe(`${id}.${'a'.repeat(24)}`);
    expect(parseBatchHash(`#/b/${id}.short`)).toBeNull();
    expect(parseBatchHash('#tools')).toBeNull();
    expect(parseBatchHash(`#/b/${id}.${'a'.repeat(24)}/extra`)).toBeNull();
  });

  it('remembers the nickname token and per-clip drafts, and forgets them on request', () => {
    const storage = memory();
    expect(loadContributor(storage)).toBeNull();
    saveContributor({ token: 't', pseudonym: 'Neema' }, storage);
    expect(loadContributor(storage)).toEqual({ token: 't', pseudonym: 'Neema' });
    saveDraft('clip1', 'mwana', storage);
    expect(loadDraft('clip1', storage)).toBe('mwana');
    expect(loadDraft('clip2', storage)).toBe('');
    saveDraft('clip1', '   ', storage);
    expect(loadDraft('clip1', storage)).toBe('');
    saveDraft('clip1', 'again', storage);
    clearDraft('clip1', storage);
    expect(loadDraft('clip1', storage)).toBe('');
    clearContributor(storage);
    expect(loadContributor(storage)).toBeNull();
    storage.data.set('sautiforge.volunteer', '{not json');
    expect(loadContributor(storage)).toBeNull();
  });

  it('keeps working when the browser blocks storage', () => {
    expect(loadContributor(broken)).toBeNull();
    expect(loadDraft('c', broken)).toBe('');
    expect(() => { saveContributor({ token: 't', pseudonym: 'N' }, broken); saveDraft('c', 'x', broken); clearDraft('c', broken); clearContributor(broken); }).not.toThrow();
    expect(loadContributor(null)).toBeNull();
  });

  it('cycles through three playback speeds with plain labels', () => {
    expect(nextSpeed(1)).toBe(0.75);
    expect(nextSpeed(0.75)).toBe(0.5);
    expect(nextSpeed(0.5)).toBe(1);
    expect(nextSpeed(3)).toBe(1); // an unknown speed falls back to normal
    expect(speedLabel(1)).toBe('normale');
    expect(speedLabel(0.75)).toBe('lente');
    expect(speedLabel(0.5)).toBe('très lente');
  });

  it('computes progress and guards against a nickname that is really personal data', () => {
    expect(progressPercent(2, 5)).toBe(40);
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(9, 5)).toBe(100);
    expect(nicknameProblem('Neema')).toBeNull();
    expect(nicknameProblem('N')).toMatch(/2 lettres/);
    expect(nicknameProblem('+243 970 123 456')).toMatch(/téléphone/);
    expect(nicknameProblem('me@mail.com')).toMatch(/e-mail/);
    expect(nicknameProblem('x'.repeat(41))).toMatch(/plus court/);
  });
});

describe('clip links', () => {
  const batchId = '00000000-0000-4000-8000-000000000901';
  const code = 'c'.repeat(24);
  const clipId = '00000000-0000-4000-8000-000000000401';

  it('builds a link to one clip and reads it back', () => {
    const url = clipLink('https://site.example/', batchId, code, clipId);
    expect(url).toBe(`https://site.example/#/c/${batchId}.${code}/${clipId}`);
    expect(parseClipHash(url.slice(url.indexOf('#')))).toEqual({ link: `${batchId}.${code}`, clipId });
  });

  it('rejects anything that is not a clip link', () => {
    expect(parseClipHash('#/c/nope')).toBeNull();
    expect(parseClipHash(`#/b/${batchId}.${code}`)).toBeNull();
    expect(parseClipHash(`#/c/${batchId}.${code}/${clipId}/extra`)).toBeNull();
  });
});
