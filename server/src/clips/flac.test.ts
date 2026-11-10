import { describe, expect, it } from 'vitest';

import { FlacError, readFlacInfo } from './flac';

/** Builds just enough of a FLAC file for the header reader: magic + STREAMINFO + a few audio bytes. */
export function fakeFlac(sampleRate: number, totalSamples: number, channels = 1, bits = 16, extra = 12): Uint8Array {
  const out = new Uint8Array(4 + 4 + 34 + extra);
  out.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
  const o = 8;
  out[o + 10] = (sampleRate >> 12) & 0xff;
  out[o + 11] = (sampleRate >> 4) & 0xff;
  out[o + 12] = ((sampleRate & 0x0f) << 4) | (((channels - 1) & 0x07) << 1) | (((bits - 1) >> 4) & 0x01);
  out[o + 13] = (((bits - 1) & 0x0f) << 4) | (Math.floor(totalSamples / 2 ** 32) & 0x0f);
  const low = totalSamples % 2 ** 32;
  out[o + 14] = (low >>> 24) & 0xff;
  out[o + 15] = (low >>> 16) & 0xff;
  out[o + 16] = (low >>> 8) & 0xff;
  out[o + 17] = low & 0xff;
  return out;
}

describe('readFlacInfo', () => {
  it('reads sample rate, channels, bit depth and duration from STREAMINFO', () => {
    expect(readFlacInfo(fakeFlac(24000, 72_000))).toEqual({ sampleRate: 24000, channels: 1, bitsPerSample: 16, totalSamples: 72_000, durationMs: 3000 });
    expect(readFlacInfo(fakeFlac(44100, 44100 * 5 + 441, 2, 24))).toMatchObject({ sampleRate: 44100, channels: 2, bitsPerSample: 24, durationMs: 5010 });
  });

  it('handles lengths beyond 32 bits', () => {
    expect(readFlacInfo(fakeFlac(48000, 2 ** 32 + 48000)).totalSamples).toBe(2 ** 32 + 48000);
  });

  it('rejects anything that is not a complete FLAC header', () => {
    expect(() => readFlacInfo(new Uint8Array(10))).toThrow(FlacError);
    expect(() => readFlacInfo(new TextEncoder().encode('RIFF'.repeat(20)))).toThrow('not a FLAC');
    expect(() => readFlacInfo(fakeFlac(24000, 0))).toThrow('how long');
    const bad = fakeFlac(24000, 100);
    bad[4] = 0x01; // not STREAMINFO first
    expect(() => readFlacInfo(bad)).toThrow('damaged');
  });
});
