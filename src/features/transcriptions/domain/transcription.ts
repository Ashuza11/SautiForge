import { z } from 'zod';

export const transcriptionSchema = z.object({
  id: z.string().uuid(),
  recordingId: z.string().uuid(),
  verbatimText: z.string().nullable(),
  normalizedText: z.string().nullable(),
  languageTags: z.array(z.string().min(1)),
  notes: z.string().nullable(),
  source: z.enum(['human', 'automatic']),
  revisionNumber: z.number().int().positive(),
  supersedesId: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  createdBy: z.string().nullable(),
});

export const transcriptionDraftSchema = transcriptionSchema.pick({
  verbatimText: true,
  normalizedText: true,
  languageTags: true,
  notes: true,
  createdBy: true,
});

export type Transcription = z.infer<typeof transcriptionSchema>;
export type TranscriptionDraft = z.infer<typeof transcriptionDraftSchema>;
