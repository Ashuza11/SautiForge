import { strToU8, zipSync } from 'fflate';

import { businessAnnotationPayloadSchema } from '../../../src/features/annotations/domain/annotation';
import { EXPORT_SCHEMA_VERSION, exportManifestSchema, validateManifestReferences, type ExportManifest } from '../../../src/features/exports/domain/manifest';
import { researchExportRecordsSchema, type ResearchExportRecords } from '../../../src/features/exports/domain/research-records';
import { loadResearchDataset, type LoadedResearchDataset } from './dataset';
import { webAnnotationDraftSchema, type WebAnnotationDraft } from './draft';

type ExportOptions = {
  now?: Date;
  newId?: () => string;
};

export type AnnotatedArchive = {
  bytes: Uint8Array;
  fileName: string;
  archiveSha256: string;
  manifest: ExportManifest;
  appliedDrafts: number;
};

export async function createAnnotatedResearchArchive(
  dataset: LoadedResearchDataset,
  inputDrafts: WebAnnotationDraft[],
  options: ExportOptions = {},
): Promise<AnnotatedArchive> {
  if (!inputDrafts.length) throw new Error('Save at least one local annotation draft before exporting.');
  const drafts = inputDrafts.map((draft) => webAnnotationDraftSchema.parse(draft));
  assertDraftsBelongToDataset(dataset, drafts);
  const idFactory = options.newId ?? (() => crypto.randomUUID());
  const exportedAt = (options.now ?? new Date()).toISOString();
  const exportId = idFactory();
  const transcriptions = [...dataset.records.transcriptions];
  const annotations = [...dataset.records.annotations];
  const draftByRecording = new Map(drafts.map((draft) => [draft.recordingId, draft]));

  const recordings = dataset.records.recordings.map((recording) => {
    const draft = draftByRecording.get(recording.id);
    if (!draft) return recording;
    const previousTranscription = latestRevision(transcriptions.filter((item) => item.recording_id === recording.id));
    const transcriptionValues = {
      verbatim_text: nullable(draft.verbatimText),
      normalized_text: nullable(draft.normalizedText),
      scenario_context: nullable(draft.scenarioContext),
      elicitation_prompt_context: nullable(draft.elicitationPromptContext),
      language_tags_json: JSON.stringify(draft.languageTags),
      notes: nullable(draft.notes),
      created_by: nullable(draft.createdBy),
    };
    const hasTranscription = Boolean(transcriptionValues.verbatim_text || transcriptionValues.normalized_text || transcriptionValues.notes || previousTranscription);
    if (hasTranscription && !sameTranscription(previousTranscription, transcriptionValues)) {
      transcriptions.push({
        id: idFactory(), recording_id: recording.id, ...transcriptionValues, source: 'human',
        revision_number: (previousTranscription?.revision_number ?? 0) + 1,
        supersedes_id: previousTranscription?.id ?? null, created_at: draft.updatedAt,
      });
    }

    const previousAnnotation = latestRevision(annotations.filter((item) => item.recording_id === recording.id && item.annotation_type === 'business.transaction'));
    const labels = businessAnnotationPayloadSchema.parse(draft.businessLabels);
    const hasBusinessLabels = Object.values(labels).some((value) => value !== null);
    if ((hasBusinessLabels || previousAnnotation) && !sameBusinessAnnotation(previousAnnotation, labels)) {
      annotations.push({
        id: idFactory(), recording_id: recording.id, annotation_type: 'business.transaction', schema_version: '1.0',
        payload_json: JSON.stringify(labels), source: 'human', revision_number: (previousAnnotation?.revision_number ?? 0) + 1,
        supersedes_id: previousAnnotation?.id ?? null, created_at: draft.updatedAt, created_by: nullable(draft.createdBy),
      });
    }
    return {
      ...recording,
      annotation_status: draft.annotationStatus,
      code_switching_status: draft.codeSwitchingStatus ?? recording.code_switching_status,
      updated_at: draft.updatedAt,
    };
  });

  const records = researchExportRecordsSchema.parse({ ...dataset.records, recordings, transcriptions, annotations });
  const entries = buildEntries(dataset, records);
  const files = await Promise.all(Object.entries(entries).map(async ([path, bytes]) => ({ path, sizeBytes: bytes.byteLength, sha256: await sha256(bytes) })));
  const manifest = exportManifestSchema.parse({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportId,
    exportType: 'research_dataset',
    exportedAt,
    app: 'SautiForge',
    databaseVersion: dataset.manifest.databaseVersion,
    projectId: records.project.id,
    sharingCategory: dataset.manifest.sharingCategory,
    sensitiveAdministrativeData: false,
    counts: {
      projects: 1,
      scenarios: records.scenarios.length,
      participants: records.participants.length,
      sessions: records.sessions.length,
      recordings: records.recordings.length,
      transcriptions: records.transcriptions.length,
      annotations: records.annotations.length,
      webDraftsApplied: drafts.length,
    },
    files,
  });
  validateManifestReferences(manifest, records.recordings.map((recording) => recording.audio_path));
  entries['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  const bytes = zipSync(entries, { level: 6 });
  const fileName = `sautiforge-${safeName(records.project.title)}-annotated-${exportedAt.slice(0, 10)}-${exportId.slice(0, 8)}.zip`;
  const archiveSha256 = await sha256(bytes);

  const verified = await loadResearchDataset({
    name: fileName,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
  if (verified.manifest.exportId !== exportId || verified.records.recordings.length !== records.recordings.length) {
    throw new Error('The generated annotation archive could not be verified. It was not offered for download.');
  }
  return { bytes, fileName, archiveSha256, manifest, appliedDrafts: drafts.length };
}

function buildEntries(dataset: LoadedResearchDataset, records: ResearchExportRecords): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {
    'metadata/project.json': strToU8(`${JSON.stringify(records.project, null, 2)}\n`),
    'metadata/scenarios.jsonl': jsonLines(records.scenarios),
    'metadata/participants.jsonl': jsonLines(records.participants),
    'metadata/participants.csv': strToU8(rowsToCsv(records.participants)),
    'metadata/sessions.jsonl': jsonLines(records.sessions),
    'metadata/recordings.jsonl': jsonLines(records.recordings),
    'metadata/transcriptions.jsonl': jsonLines(records.transcriptions),
    'metadata/annotations.jsonl': jsonLines(records.annotations),
  };
  for (const recording of records.recordings) {
    const audio = dataset.entries.get(recording.audio_path);
    if (!audio) throw new Error(`Original audio is missing from the open dataset: ${recording.audio_path}`);
    entries[recording.audio_path] = Uint8Array.from(audio);
  }
  return entries;
}

function assertDraftsBelongToDataset(dataset: LoadedResearchDataset, drafts: WebAnnotationDraft[]): void {
  const recordingIds = new Set(dataset.records.recordings.map((recording) => recording.id));
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (draft.sourceManifestSha256 !== dataset.manifestSha256) throw new Error('A draft belongs to a different source dataset.');
    if (!recordingIds.has(draft.recordingId)) throw new Error('A draft references a recording that is not in this dataset.');
    if (seen.has(draft.recordingId)) throw new Error(`Duplicate draft for recording ${draft.recordingId}.`);
    seen.add(draft.recordingId);
  }
}

function latestRevision<T extends { revision_number: number }>(items: T[]): T | undefined {
  return items.sort((left, right) => right.revision_number - left.revision_number)[0];
}

function sameTranscription(previous: ResearchExportRecords['transcriptions'][number] | undefined, values: {
  verbatim_text: string | null;
  normalized_text: string | null;
  scenario_context: string | null;
  elicitation_prompt_context: string | null;
  language_tags_json: string;
  notes: string | null;
  created_by: string | null;
}): boolean {
  return Boolean(previous && previous.source === 'human' && Object.entries(values).every(([key, value]) => previous[key as keyof typeof values] === value));
}

function sameBusinessAnnotation(previous: ResearchExportRecords['annotations'][number] | undefined, labels: ReturnType<typeof businessAnnotationPayloadSchema.parse>): boolean {
  if (!previous || previous.source !== 'human') return false;
  try { return JSON.stringify(businessAnnotationPayloadSchema.parse(JSON.parse(previous.payload_json))) === JSON.stringify(labels); }
  catch { return false; }
}

function nullable(value: string): string | null {
  return value.trim().length ? value : null;
}

function jsonLines(rows: unknown[]): Uint8Array {
  return strToU8(rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '');
}

function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return `${headers.map(cell).join(',')}\n${rows.map((row) => headers.map((key) => cell(row[key])).join(',')).join('\n')}\n`;
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
