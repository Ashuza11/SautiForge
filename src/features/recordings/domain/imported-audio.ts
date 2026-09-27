const supportedExtensions = new Set(['.m4a', '.mp4', '.aac', '.wav', '.ogg', '.oga', '.opus', '.mp3', '.webm', '.3gp', '.amr', '.flac']);

const mimeExtensions: Record<string, string> = {
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/mpeg': '.mp3',
  'audio/webm': '.webm',
  'audio/3gpp': '.3gp',
  'audio/amr': '.amr',
  'audio/flac': '.flac',
};

export function describeImportedAudio(name: string, mimeType: string | null): { extension: string; container: string; mimeType: string | null } {
  const normalizedMime = mimeType?.toLowerCase().split(';')[0]?.trim() || null;
  const dot = name.lastIndexOf('.');
  const fromName = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (normalizedMime && !normalizedMime.startsWith('audio/') && normalizedMime !== 'application/octet-stream') {
    throw new Error('Select an audio file. Other document types are not accepted.');
  }
  const extension = supportedExtensions.has(fromName) ? fromName : normalizedMime ? mimeExtensions[normalizedMime] : undefined;
  if (!extension || !supportedExtensions.has(extension)) throw new Error('This audio format is not supported for import.');
  const container = extension === '.oga' ? 'ogg' : extension.slice(1);
  return { extension, container, mimeType: normalizedMime };
}

export function importedDurationMs(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('The selected audio duration could not be determined.');
  return Math.round(durationSeconds * 1000);
}
