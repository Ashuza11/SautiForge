import { describe, expect, it } from 'vitest';

import { parseWav16Mono, peakEnvelope } from './wav';

function wav(samples: number[], rate = 16_000, extraChunk = false): ArrayBuffer {
  const data = new Int16Array(samples);
  const extra = extraChunk ? 12 : 0;
  const buffer = new ArrayBuffer(44 + extra + data.byteLength);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  let offset = 36;
  if (extraChunk) { text(offset, 'LIST'); view.setUint32(offset + 4, 4, true); offset += 12; }
  text(offset, 'data'); view.setUint32(offset + 4, data.byteLength, true);
  new Int16Array(buffer, offset + 8, data.length).set(data);
  return buffer;
}

describe('wav parsing', () => {
  it('reads rate and samples, skipping unrelated chunks', () => {
    const audio = parseWav16Mono(wav([0, 100, -200, 300], 16_000, true));
    expect(audio.sampleRate).toBe(16_000);
    expect(Array.from(audio.samples)).toEqual([0, 100, -200, 300]);
  });

  it('rejects non-WAV and non-mono input', () => {
    expect(() => parseWav16Mono(new ArrayBuffer(100))).toThrow(/not a WAV/);
    const stereo = wav([1, 2]);
    new DataView(stereo).setUint16(22, 2, true);
    expect(() => parseWav16Mono(stereo)).toThrow(/mono 16-bit/);
  });

  it('computes peak envelopes for a time range', () => {
    const samples = new Array(16_000).fill(0);
    samples[8_000] = 16_384;
    const audio = parseWav16Mono(wav(samples));
    const peaks = peakEnvelope(audio, 0, 1_000, 4);
    expect(Array.from(peaks).map((value) => Math.round(value * 100))).toEqual([0, 0, 50, 0]);
    expect(peakEnvelope(audio, 2_000, 3_000, 4)).toEqual(new Float32Array(4));
  });
});
