import { z } from 'zod';

import { transcriptTextSchema } from '../volunteer/volunteer';

export const finalDecisionSchema = z.enum(['approved', 'excluded']);

/** What the admin sends: approve a text (chosen from a volunteer's answer or typed), or exclude the clip. */
export const finalDraftSchema = z.object({
  decision: finalDecisionSchema,
  text: transcriptTextSchema.nullish().transform((value) => value ?? null),
  chosenSubmissionId: z.string().uuid().nullish().transform((value) => value ?? null),
  note: z.string().trim().max(500).nullish().transform((value) => value ?? ''),
}).strict().superRefine((value, context) => {
  if (value.decision === 'approved' && !value.text) {
    context.addIssue({ code: 'custom', path: ['text'], message: 'Write or choose the final text.' });
  }
  if (value.decision === 'excluded' && value.text) {
    context.addIssue({ code: 'custom', path: ['text'], message: 'An excluded clip has no text.' });
  }
});

export type FinalDraft = z.infer<typeof finalDraftSchema>;

export type FinalTranscript = {
  id: string;
  clipId: string;
  version: number;
  decision: 'approved' | 'excluded';
  text: string | null;
  chosenSubmissionId: string | null;
  note: string;
  createdBy: string;
  createdAt: string;
};
