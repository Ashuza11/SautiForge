import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { File } from 'expo-file-system';

export async function hashAudioFile(file: File): Promise<string> {
  const digest = sha256.create();
  const reader = file.readableStream().getReader();
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    digest.update(part.value);
  }
  return bytesToHex(digest.digest());
}
