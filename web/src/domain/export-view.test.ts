import { describe, expect, it } from 'vitest';

import { exportCommand, formatDuration, transcriptsCsv, type ExportManifest } from './export-view';

const manifest = (texts: string[]): ExportManifest => ({
  generatedAt: '2026-11-10T12:00:00.000Z',
  project: { id: 'p', title: 'Mashi', languageCode: 'shr', targetLanguage: 'Shi', languageVariety: 'Mashi' },
  source: { id: 's', title: 'A film', originalUrl: null, creator: null },
  rights: null,
  totals: { approved: texts.length, excluded: 0, notExported: 0, durationMs: 0 },
  clips: texts.map((transcript, index) => ({
    clipId: `id${index}`, clipKey: `c00${index}`, transcript, finalVersion: 1, note: '', durationMs: 3020, transcribers: 2, sampleRate: 24000, derivedFrom: 'cleaned' as const,
    flac: { url: 'https://x', sha256: 'a', sizeBytes: 1, pcmSha256: null },
  })),
});

describe('export helpers', () => {
  it('writes a CSV that keeps accents, commas, quotes and line breaks safe', () => {
    const csv = transcriptsCsv(manifest(['mwâna wa', 'a, "b"\nc']));
    expect(csv.startsWith('﻿clip_id,transcript,final_version,duration_s,transcribers,note\r\n')).toBe(true);
    expect(csv).toContain('c000,mwâna wa,1,3.020,2,');
    expect(csv).toContain('c001,"a, ""b""\nc",1,3.020,2,');
  });

  it('reads durations and builds the local export command', () => {
    expect(formatDuration(42_000)).toBe('42 s');
    expect(formatDuration(207_000)).toBe('3 min 27 s');
    expect(formatDuration(3_900_000)).toBe('1 h 5 min');
    expect(exportCommand('https://site.vercel.app/', 'abc')).toBe('python -m sautiseg export-dataset --api https://site.vercel.app --source-id abc --out dataset');
  });
});
