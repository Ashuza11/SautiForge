export type StoredFileDescription = { path: string; size: number };

export function classifyRecordingFiles(referencedPaths: string[], storedFiles: StoredFileDescription[]) {
  const referenced = new Set(referencedPaths);
  const stored = new Map(storedFiles.map((file) => [file.path, file]));
  const quarantinedPaths = storedFiles.filter((file) => file.size <= 0 || !referenced.has(file.path)).map((file) => file.path);
  const missingPaths = referencedPaths.filter((path) => !stored.has(path) || (stored.get(path)?.size ?? 0) <= 0);
  const verifiedFiles = referencedPaths.length - missingPaths.length;
  return { quarantinedPaths, missingPaths, verifiedFiles };
}
