import { describe, expect, it } from 'vitest';

import { hashAudioFile } from './audio-hash';

describe('audio content hashing', () => {
  it('streams the complete file into a lowercase SHA-256 digest', async () => {
    const chunks = [new TextEncoder().encode('a'), new TextEncoder().encode('bc')];
    const file = {
      readableStream: () => new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    };

    await expect(hashAudioFile(file as never)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
