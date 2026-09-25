export function requireReadableByteCount(byteCount: number): void {
  if (!Number.isSafeInteger(byteCount) || byteCount < 1) {
    throw new Error('Audio file exists but its contents could not be read.');
  }
}
