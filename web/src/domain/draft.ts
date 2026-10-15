import { z } from 'zod';

import { businessAnnotationPayloadSchema, type BusinessAnnotationPayload } from '../../../src/features/annotations/domain/annotation';
import type { LoadedResearchDataset, ResearchRecording } from './dataset';
import { latestTranscription } from './dataset';

const annotationStatusSchema = z.enum(['recorded', 'needs_transcription', 'transcribed', 'needs_review', 'validated', 'rejected']);

export const webAnnotationDraftSchema = z.object({
  schemaVersion: z.literal(1),
  sourceManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  recordingId: z.string().uuid(),
  verbatimText: z.string(),
  normalizedText: z.string(),
  scenarioContext: z.string().max(500),
  elicitationPromptContext: z.string().max(1_000),
  languageTags: z.array(z.string().trim().min(1)),
  notes: z.string(),
  createdBy: z.string(),
  annotationStatus: annotationStatusSchema,
  businessLabels: businessAnnotationPayloadSchema,
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export type WebAnnotationDraft = z.infer<typeof webAnnotationDraftSchema>;

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class LocalDraftRepository {
  constructor(private readonly storage: DraftStorage) {}

  load(manifestSha256: string, recordingId: string): WebAnnotationDraft | null {
    let value: string | null;
    try {
      value = this.storage.getItem(draftKey(manifestSha256, recordingId));
    } catch {
      throw new Error('Browser storage is unavailable. Drafts cannot be loaded or verified in this browser mode.');
    }
    if (!value) return null;
    try {
      return webAnnotationDraftSchema.parse(JSON.parse(value));
    } catch {
      throw new Error('This browser contains an invalid annotation draft for this recording. Clear it before continuing.');
    }
  }

  save(draft: WebAnnotationDraft): WebAnnotationDraft {
    const validated = webAnnotationDraftSchema.parse(draft);
    const key = draftKey(validated.sourceManifestSha256, validated.recordingId);
    try {
      this.storage.setItem(key, JSON.stringify(validated));
    } catch {
      throw new Error('The draft could not be written to browser storage. Check available storage and browser privacy settings.');
    }
    const verified = this.load(validated.sourceManifestSha256, validated.recordingId);
    if (!verified || JSON.stringify(verified) !== JSON.stringify(validated)) {
      throw new Error('The draft was not readable after saving. It has not been confirmed as saved.');
    }
    return verified;
  }

  clear(manifestSha256: string, recordingId: string): void {
    try {
      this.storage.removeItem(draftKey(manifestSha256, recordingId));
      if (this.storage.getItem(draftKey(manifestSha256, recordingId)) !== null) {
        throw new Error('The local draft could not be removed from browser storage.');
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('could not be removed')) throw cause;
      throw new Error('Browser storage is unavailable. The local draft could not be removed or verified.');
    }
  }

  listForDataset(dataset: LoadedResearchDataset): WebAnnotationDraft[] {
    return dataset.records.recordings
      .map((recording) => this.load(dataset.manifestSha256, recording.id))
      .filter((draft): draft is WebAnnotationDraft => draft !== null);
  }
}

export function initialDraft(dataset: LoadedResearchDataset, recording: ResearchRecording, now = new Date()): WebAnnotationDraft {
  const transcription = latestTranscription(dataset, recording.id);
  const annotation = dataset.records.annotations
    .filter((item) => item.recording_id === recording.id && item.annotation_type === 'business.transaction')
    .sort((left, right) => right.revision_number - left.revision_number)[0];
  const parsedBusiness = annotation ? businessAnnotationPayloadSchema.safeParse(parseJson(annotation.payload_json)) : null;
  const scenario = dataset.records.scenarios.find((item) => item.id === recording.scenario_id);
  return webAnnotationDraftSchema.parse({
    schemaVersion: 1,
    sourceManifestSha256: dataset.manifestSha256,
    recordingId: recording.id,
    verbatimText: transcription?.verbatim_text ?? '',
    normalizedText: transcription?.normalized_text ?? '',
    scenarioContext: transcription?.scenario_context ?? scenario?.title ?? '',
    elicitationPromptContext: transcription?.elicitation_prompt_context ?? recording.elicitation_prompt_text ?? '',
    languageTags: parseStringList(transcription?.language_tags_json ?? recording.spoken_languages_json),
    notes: transcription?.notes ?? '',
    createdBy: transcription?.created_by ?? '',
    annotationStatus: recording.annotation_status,
    businessLabels: parsedBusiness?.success ? parsedBusiness.data : emptyBusinessLabels(),
    updatedAt: now.toISOString(),
  });
}

export function emptyBusinessLabels(): BusinessAnnotationPayload {
  return {
    transactionIntent: null,
    productOrService: null,
    quantity: null,
    amount: null,
    currency: null,
    amountPaid: null,
    outstandingDebt: null,
    paymentMethod: null,
    transactionReference: null,
  };
}

export function prepareDraftForSave(draft: WebAnnotationDraft, now = new Date()): WebAnnotationDraft {
  const annotationStatus = draft.verbatimText.trim() && ['recorded', 'needs_transcription'].includes(draft.annotationStatus)
    ? 'transcribed'
    : draft.annotationStatus;
  return webAnnotationDraftSchema.parse({ ...draft, annotationStatus, updatedAt: now.toISOString() });
}

function draftKey(manifestSha256: string, recordingId: string): string {
  return `sautiforge.web.draft.v1.${manifestSha256}.${recordingId}`;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch { return null; }
}

function parseStringList(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}
