import { Directory, File, Paths } from 'expo-file-system';

const RECORDINGS_DIRECTORY = 'recordings';

export type PersistedAudioFile = {
  file: File;
  relativePath: string;
  size: number;
};

export function hasRecordingSpace(minimumBytes = 50 * 1024 * 1024): boolean {
  return Paths.availableDiskSpace >= minimumBytes;
}

async function verifyReadable(file: File): Promise<number> {
  if (!file.exists || !file.size || file.size <= 0) throw new Error('Audio file is missing or empty.');
  await file.slice(0, 1).arrayBuffer();
  return file.size;
}

export async function copyAcceptedTake(sourceUri: string, projectId: string, recordingId: string, extension: string): Promise<PersistedAudioFile> {
  const safeExtension = /^\.[a-z0-9]+$/i.test(extension) ? extension.toLowerCase() : '.m4a';
  const source = new File(sourceUri);
  await verifyReadable(source);

  const directory = new Directory(Paths.document, RECORDINGS_DIRECTORY, projectId);
  directory.create({ intermediates: true, idempotent: true });
  const target = new File(directory, `${recordingId}${safeExtension}`);
  if (target.exists) throw new Error('A recording file with this ID already exists.');

  await source.copy(target);
  const size = await verifyReadable(target);
  return { file: target, relativePath: `${RECORDINGS_DIRECTORY}/${projectId}/${target.name}`, size };
}

export function discardFile(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export function getRecordingFile(relativePath: string): File {
  const file = new File(Paths.document, relativePath);
  if (!file.exists || !file.size || file.size <= 0) throw new Error('The stored audio file is missing or empty.');
  return file;
}
