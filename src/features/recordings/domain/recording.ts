import { z } from 'zod';

export const annotationStatusSchema = z.enum(['recorded', 'needs_transcription', 'transcribed', 'needs_review', 'validated', 'rejected']);
export const captureSourceSchema = z.enum(['device_microphone', 'imported_file']);
export const transportSchema = z.enum(['whatsapp_manual', 'other_messaging', 'file_transfer', 'other']);
export const promptExposureSchema = z.enum(['instructions_only', 'example_shown', 'scripted_reading']);

export const recordingSchema = z.object({
  id: z.string().uuid(),
  displayId: z.string().min(1),
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  participantId: z.string().uuid(),
  scenarioId: z.string().uuid(),
  consentRecordId: z.string().uuid(),
  scenarioVersion: z.string(),
  scenarioPromptSnapshot: z.record(z.string(), z.unknown()),
  relativeAudioPath: z.string().min(1),
  collectionMethod: z.string().min(1),
  recordedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
  fileSizeBytes: z.number().int().positive(),
  container: z.string().min(1),
  codec: z.string().nullable(),
  sampleRateHz: z.number().int().positive().nullable(),
  channelCount: z.number().int().positive().nullable(),
  captureSource: captureSourceSchema,
  transport: transportSchema.nullable(),
  promptExposure: promptExposureSchema,
  importedAt: z.string().datetime({ offset: true }).nullable(),
  sourceMimeType: z.string().min(1).nullable(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  externalSubmissionId: z.string().trim().min(1).max(80).nullable(),
  elicitationPromptText: z.string().trim().min(1).max(1000).nullable(),
  sourceFileName: z.string().trim().min(1).max(255).nullable(),
  spokenLanguages: z.array(z.string().min(1)).min(1),
  languageVariety: z.string().nullable(),
  codeSwitchingStatus: z.string().nullable(),
  recordingEnvironment: z.string().nullable(),
  noiseLevel: z.string().nullable(),
  qualityRating: z.number().int().min(1).max(5).nullable(),
  notes: z.string().nullable(),
  annotationStatus: annotationStatusSchema,
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const recordingMetadataDraftSchema = recordingSchema.pick({
  spokenLanguages: true,
  languageVariety: true,
  codeSwitchingStatus: true,
  recordingEnvironment: true,
  noiseLevel: true,
  qualityRating: true,
  notes: true,
}).extend({ annotationStatus: annotationStatusSchema });

export type Recording = z.infer<typeof recordingSchema>;
export type RecordingMetadataDraft = z.infer<typeof recordingMetadataDraftSchema>;

export const recordingPromptCorrectionDraftSchema = z.object({
  correctedPromptText: z.string().trim().min(1, 'Select the correct example.').max(1000),
  reason: z.string().trim().min(3, 'Explain why this association is being corrected.').max(1000),
  correctedBy: z.string().trim().min(1).max(160).nullable(),
});

export const recordingPromptCorrectionSchema = recordingPromptCorrectionDraftSchema.extend({
  id: z.string().uuid(),
  recordingId: z.string().uuid(),
  previousPromptText: z.string().trim().min(1).max(1000),
  createdAt: z.string().datetime({ offset: true }),
});

export type RecordingPromptCorrectionDraft = z.infer<typeof recordingPromptCorrectionDraftSchema>;
export type RecordingPromptCorrection = z.infer<typeof recordingPromptCorrectionSchema>;

export function recordingSnapshotExamples(recording: Pick<Recording, 'scenarioPromptSnapshot'>): string[] {
  return z.array(z.string().trim().min(1).max(500)).max(25)
    .parse(recording.scenarioPromptSnapshot.remoteExamples ?? []);
}

export const acceptedTakeSchema = z.object({
  sourceUri: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  recordedAt: z.string().datetime({ offset: true }),
  extension: z.string().regex(/^\.[a-z0-9]+$/),
  container: z.string().min(1),
  codec: z.string().nullable(),
  sampleRateHz: z.number().int().positive().nullable(),
  channelCount: z.number().int().positive().nullable(),
  captureSource: captureSourceSchema,
  transport: transportSchema.nullable(),
  promptExposure: promptExposureSchema,
  importedAt: z.string().datetime({ offset: true }).nullable(),
  sourceMimeType: z.string().min(1).nullable(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  externalSubmissionId: z.string().trim().min(1).max(80).nullable(),
  elicitationPromptText: z.string().trim().min(1).max(1000).nullable(),
  sourceFileName: z.string().trim().min(1).max(255).nullable(),
}).superRefine((take, context) => {
  if (take.captureSource !== 'imported_file') return;
  if (!take.transport) context.addIssue({ code: 'custom', path: ['transport'], message: 'Imported audio must record how it arrived.' });
  if (!take.importedAt) context.addIssue({ code: 'custom', path: ['importedAt'], message: 'Imported audio must record its import time.' });
  if (!take.contentSha256) context.addIssue({ code: 'custom', path: ['contentSha256'], message: 'Imported audio must have a verified SHA-256 hash.' });
  if (!take.externalSubmissionId) context.addIssue({ code: 'custom', path: ['externalSubmissionId'], message: 'Imported audio must have a pseudonymous submission code.' });
  if (take.promptExposure === 'example_shown' && !take.elicitationPromptText) {
    context.addIssue({ code: 'custom', path: ['elicitationPromptText'], message: 'Select the example used for this recording.' });
  }
});

export type AcceptedTake = z.infer<typeof acceptedTakeSchema>;

export function elicitationPromptSelectionError(take: Pick<AcceptedTake, 'promptExposure' | 'elicitationPromptText'>): string | null {
  if (take.promptExposure === 'example_shown' && !take.elicitationPromptText?.trim()) {
    return 'Choose the example this audio responds to before saving.';
  }
  return null;
}
