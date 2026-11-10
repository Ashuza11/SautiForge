export type FlacInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  totalSamples: number;
  durationMs: number;
};

export class FlacError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Reads the mandatory STREAMINFO block at the start of a FLAC file.
 * Only the header is trusted for sample rate and length; the audio itself is not decoded here.
 */
export function readFlacInfo(bytes: Uint8Array): FlacInfo {
  if (bytes.length < 42 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
    throw new FlacError('This is not a FLAC file.');
  }
  const blockType = bytes[4] & 0x7f;
  const blockLength = (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
  if (blockType !== 0 || blockLength !== 34) {
    throw new FlacError('The FLAC header is damaged.');
  }
  const at = (offset: number) => bytes[8 + offset];
  const sampleRate = (at(10) << 12) | (at(11) << 4) | (at(12) >> 4);
  const channels = ((at(12) >> 1) & 0x07) + 1;
  const bitsPerSample = (((at(12) & 0x01) << 4) | (at(13) >> 4)) + 1;
  const totalSamples = (at(13) & 0x0f) * 2 ** 32 + ((at(14) << 24) >>> 0) + (at(15) << 16) + (at(16) << 8) + at(17);
  if (sampleRate === 0 || totalSamples === 0) {
    throw new FlacError('The FLAC file does not say how long it is. Convert it again with the pack command.');
  }
  return { sampleRate, channels, bitsPerSample, totalSamples, durationMs: Math.round((totalSamples * 1000) / sampleRate) };
}
