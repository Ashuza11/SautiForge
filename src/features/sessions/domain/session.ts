import { z } from 'zod';

export const sessionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  participantId: z.string().uuid(),
  consentRecordId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  deviceMetadata: z.record(z.string(), z.unknown()),
  collectionEnvironment: z.string().trim().min(1, 'Collection environment is required').max(240),
  city: z.string().trim().max(120).nullable(),
  researcherNotes: z.string().trim().max(2000).nullable(),
  status: z.enum(['in_progress', 'paused', 'completed', 'archived']),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const sessionDraftSchema = sessionSchema.pick({
  collectionEnvironment: true,
  city: true,
  researcherNotes: true,
  deviceMetadata: true,
});

export type CollectionSession = z.infer<typeof sessionSchema>;
export type SessionDraft = z.infer<typeof sessionDraftSchema>;
