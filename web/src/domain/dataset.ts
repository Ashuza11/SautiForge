import { strFromU8, unzipSync, type Unzipped } from 'fflate';
import { z } from 'zod';

import { exportManifestSchema, validateManifestReferences, validateRelativeArchivePath, type ExportManifest } from '../../../src/features/exports/domain/manifest';
import { researchExportRecordsSchema } from '../../../src/features/exports/domain/research-records';

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const requiredMetadataPaths = [
  'metadata/project.json',
  'metadata/scenarios.jsonl',
  'metadata/participants.jsonl',
  'metadata/sessions.jsonl',
  'metadata/recordings.jsonl',
  'metadata/transcriptions.jsonl',
  'metadata/annotations.jsonl',
] as const;

export type ResearchRecords = z.infer<typeof researchExportRecordsSchema>;
export type ResearchRecording = ResearchRecords['recordings'][number];
export type ResearchTranscription = ResearchRecords['transcriptions'][number];

export type ArchiveInput = {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type LoadedResearchDataset = {
  fileName: string;
  manifest: ExportManifest;
  manifestSha256: string;
  records: ResearchRecords;
  entries: ReadonlyMap<string, Uint8Array>;
};

export async function loadResearchDataset(input: ArchiveInput): Promise<LoadedResearchDataset> {
  if (!input.name.toLowerCase().endsWith('.zip')) throw new Error('Select a SautiForge ZIP export.');
  if (input.size <= 0) throw new Error('The selected ZIP is empty.');
  if (input.size > MAX_ARCHIVE_BYTES) throw new Error('This ZIP is larger than the 2 GB browser safety limit.');

  let unpacked: Unzipped;
  try {
    unpacked = unzipSync(new Uint8Array(await input.arrayBuffer()));
  } catch {
    throw new Error('The selected file is not a readable ZIP archive.');
  }

  const entries = new Map(Object.entries(unpacked).filter(([path]) => !path.endsWith('/')));
  const manifestBytes = requireEntry(entries, 'manifest.json');
  const manifest = parseJson(manifestBytes, 'manifest.json', exportManifestSchema);
  if (manifest.exportType !== 'research_dataset' || manifest.sensitiveAdministrativeData) {
    throw new Error('Open a research dataset export, not a private administrative backup.');
  }

  const declaredPaths = new Set<string>();
  for (const member of manifest.files) {
    if (!validateRelativeArchivePath(member.path)) throw new Error(`Unsafe archive path: ${member.path}`);
    if (declaredPaths.has(member.path)) throw new Error(`Duplicate manifest path: ${member.path}`);
    declaredPaths.add(member.path);
    const bytes = requireEntry(entries, member.path);
    if (bytes.byteLength !== member.sizeBytes) throw new Error(`Size mismatch for ${member.path}.`);
    if (await sha256(bytes) !== member.sha256) throw new Error(`SHA-256 mismatch for ${member.path}.`);
  }
  for (const path of requiredMetadataPaths) {
    if (!declaredPaths.has(path)) throw new Error(`${path} is missing from the manifest.`);
  }
  for (const path of entries.keys()) {
    if (path !== 'manifest.json' && !declaredPaths.has(path)) throw new Error(`Undeclared ZIP member: ${path}`);
  }

  const records = researchExportRecordsSchema.parse({
    project: parseJson(requireEntry(entries, 'metadata/project.json'), 'metadata/project.json', z.unknown()),
    scenarios: parseJsonLines(requireEntry(entries, 'metadata/scenarios.jsonl'), 'metadata/scenarios.jsonl'),
    participants: parseJsonLines(requireEntry(entries, 'metadata/participants.jsonl'), 'metadata/participants.jsonl'),
    sessions: parseJsonLines(requireEntry(entries, 'metadata/sessions.jsonl'), 'metadata/sessions.jsonl'),
    recordings: parseJsonLines(requireEntry(entries, 'metadata/recordings.jsonl'), 'metadata/recordings.jsonl'),
    transcriptions: parseJsonLines(requireEntry(entries, 'metadata/transcriptions.jsonl'), 'metadata/transcriptions.jsonl'),
    annotations: parseJsonLines(requireEntry(entries, 'metadata/annotations.jsonl'), 'metadata/annotations.jsonl'),
  });
  validateManifestReferences(manifest, records.recordings.map((recording) => recording.audio_path));
  validateCount(manifest, 'recordings', records.recordings.length);
  validateCount(manifest, 'participants', records.participants.length);
  validateCount(manifest, 'sessions', records.sessions.length);
  validateCount(manifest, 'transcriptions', records.transcriptions.length);
  validateCount(manifest, 'annotations', records.annotations.length);

  return {
    fileName: input.name,
    manifest,
    manifestSha256: await sha256(manifestBytes),
    records,
    entries,
  };
}

export function latestTranscription(dataset: LoadedResearchDataset, recordingId: string): ResearchTranscription | null {
  return dataset.records.transcriptions
    .filter((item) => item.recording_id === recordingId)
    .sort((left, right) => right.revision_number - left.revision_number)[0] ?? null;
}

export function audioMimeType(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  if (extension === 'm4a' || extension === 'mp4') return 'audio/mp4';
  if (extension === 'ogg' || extension === 'opus') return 'audio/ogg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'flac') return 'audio/flac';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'webm') return 'audio/webm';
  return 'application/octet-stream';
}

export function matchesRecordingQuery(recording: ResearchRecording, speakerCode: string, scenarioTitle: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [recording.display_id, speakerCode, scenarioTitle, recording.annotation_status, recording.spoken_languages_json]
    .some((value) => String(value).toLowerCase().includes(needle));
}

function requireEntry(entries: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const entry = entries.get(path);
  if (!entry) throw new Error(`ZIP member is missing: ${path}`);
  return entry;
}

function parseJson<T extends z.ZodType>(bytes: Uint8Array, path: string, schema: T): z.infer<T> {
  try {
    return schema.parse(JSON.parse(strFromU8(bytes)));
  } catch (cause) {
    if (cause instanceof z.ZodError) throw new Error(`${path} does not match the SautiForge schema.`);
    throw new Error(`${path} is not valid JSON.`);
  }
}

function parseJsonLines(bytes: Uint8Array, path: string): unknown[] {
  return strFromU8(bytes).split(/\r?\n/).filter((line) => line.trim().length > 0).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${path} line ${index + 1} is not valid JSON.`); }
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function validateCount(manifest: ExportManifest, name: string, actual: number): void {
  const declared = manifest.counts[name];
  if (declared !== actual) throw new Error(`${name} count mismatch: expected ${String(declared)}, found ${actual}.`);
}
