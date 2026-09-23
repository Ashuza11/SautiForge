import { z } from 'zod';

export const annotationStatusSchema = z.enum(['recorded', 'needs_transcription', 'transcribed', 'needs_review', 'validated', 'rejected']);

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

export type AcceptedTake = {
  sourceUri: string;
  durationMs: number;
  recordedAt: string;
  extension: string;
  container: string;
  codec: string | null;
  sampleRateHz: number | null;
  channelCount: number | null;
};
