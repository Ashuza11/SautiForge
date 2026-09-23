import { z } from 'zod';

export const participantSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  speakerCode: z.string().trim().min(1, 'Speaker ID is required').max(80),
  primaryLanguage: z.string().trim().min(1, 'Primary language is required').max(120),
  languageVariety: z.string().trim().max(120).nullable(),
  otherLanguages: z.array(z.string().trim().min(1).max(120)),
  ageBracket: z.string().trim().max(80).nullable(),
  genderSelfDescribed: z.string().trim().max(120).nullable(),
  businessCategory: z.string().trim().max(160).nullable(),
  yearsBusinessExperience: z.number().min(0).max(100).nullable(),
  researchNotes: z.string().trim().max(2000).nullable(),
  status: z.enum(['active', 'withdrawn', 'archived']),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const participantDraftSchema = participantSchema.omit({
  id: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
});

export type Participant = z.infer<typeof participantSchema>;
export type ParticipantDraft = z.infer<typeof participantDraftSchema>;
