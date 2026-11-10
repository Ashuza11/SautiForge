import { z } from 'zod';

export const MAX_BATCH_CLIPS = 10;

export const batchStatusSchema = z.enum(['open', 'closed']);

const adminCodeSchema = z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/, 'Use a pseudonymous administrator code.');

export const batchDraftSchema = z.object({
  title: z.string().trim().max(80).nullish().transform((value) => value || null),
  clipIds: z.array(z.string().uuid()).min(1, 'Choose at least one clip.').max(MAX_BATCH_CLIPS, `A batch holds at most ${MAX_BATCH_CLIPS} clips.`),
}).strict().refine((value) => new Set(value.clipIds).size === value.clipIds.length, { path: ['clipIds'], message: 'A clip can appear only once.' });

export const batchSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
  title: z.string().min(1).max(80),
  status: batchStatusSchema,
  createdBy: adminCodeSchema,
  createdAt: z.string().datetime({ offset: true }),
  closedAt: z.string().datetime({ offset: true }).nullable(),
});

export type Batch = z.infer<typeof batchSchema>;
export type BatchDraft = z.infer<typeof batchDraftSchema>;
/** A batch with its clips in order. The link token is added by the service. */
export type BatchWithClips = { batch: Batch; clipIds: string[] };
