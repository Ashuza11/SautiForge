export interface WavAudio {
  sampleRate: number;
  samples: Int16Array;
}

/** Parse the 16-bit mono PCM WAV written by the segmentation tool. */
export function parseWav16Mono(buffer: ArrayBuffer): WavAudio {
  const view = new DataView(buffer);
  const tag = (offset: number) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
  if (buffer.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('The working audio is not a WAV file.');
  let sampleRate = 0;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error('The working audio must be mono 16-bit PCM.');
    } else if (id === 'data') {
      if (!sampleRate) throw new Error('The WAV data appears before its format description.');
      const length = Math.min(size, buffer.byteLength - body) & ~1;
      return { sampleRate, samples: new Int16Array(buffer.slice(body, body + length)) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('The WAV file has no audio data.');
}

/** Peak amplitude (0..1) per bucket for drawing a waveform of a time range. */
export function peakEnvelope(audio: WavAudio, startMs: number, endMs: number, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets);
  const first = Math.max(0, Math.floor((startMs * audio.sampleRate) / 1000));
  const last = Math.min(audio.samples.length, Math.ceil((endMs * audio.sampleRate) / 1000));
  const span = last - first;
  if (span <= 0 || buckets <= 0) return peaks;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = first + Math.floor((bucket * span) / buckets);
    const to = Math.max(from + 1, first + Math.floor(((bucket + 1) * span) / buckets));
    let max = 0;
    for (let i = from; i < to && i < last; i += 1) max = Math.max(max, Math.abs(audio.samples[i]!));
    peaks[bucket] = max / 32768;
  }
  return peaks;
}

/**
 * A read-only handle on decoded audio. The samples live in a closure, so React never sees (or in
 * development mode, inspects) millions of numbers when this is passed as a prop.
 */
export interface AudioView {
  readonly sampleRate: number;
  readonly durationMs: number;
  peaks(startMs: number, endMs: number, buckets: number): Float32Array;
}

export function createAudioView(audio: WavAudio): AudioView {
  const { sampleRate, samples } = audio;
  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  return { sampleRate, durationMs, peaks: (startMs, endMs, buckets) => peakEnvelope({ sampleRate, samples }, startMs, endMs, buckets) };
}
