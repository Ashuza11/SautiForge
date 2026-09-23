import { z } from 'zod';

export const consentRecordSchema = z.object({
  id: z.string().uuid(),
  participantId: z.string().uuid(),
  status: z.enum(['granted', 'declined', 'withdrawn', 'expired']),
  internalResearch: z.boolean(),
  restrictedAnnotation: z.boolean(),
  publicRelease: z.boolean(),
  recordedBy: z.string().trim().max(160).nullable(),
  consentedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).nullable(),
  supersedesId: z.string().uuid().nullable(),
  notes: z.string().trim().max(2000).nullable(),
  consentProtocolVersion: z.string().trim().min(1, 'Consent protocol version is required').max(80),
  createdAt: z.string().datetime({ offset: true }),
});

export const consentDraftSchema = consentRecordSchema.omit({
  id: true,
  participantId: true,
  supersedesId: true,
  createdAt: true,
}).superRefine((value, context) => {
  if (value.status !== 'granted' && (value.internalResearch || value.restrictedAnnotation || value.publicRelease)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Declined or withdrawn consent cannot approve data uses.' });
  }
  if (value.publicRelease && !value.internalResearch) {
    context.addIssue({ code: 'custom', path: ['publicRelease'], message: 'Public release also requires internal research approval.' });
  }
});

export type ConsentRecord = z.infer<typeof consentRecordSchema>;
export type ConsentDraft = z.infer<typeof consentDraftSchema>;

export function canRecord(consent: ConsentRecord | null, at = new Date()): boolean {
  if (!consent || consent.status !== 'granted' || !consent.internalResearch) return false;
  if (!consent.validUntil) return true;
  return new Date(consent.validUntil).getTime() >= at.getTime();
}

export type SharingCategory = 'internal_research' | 'restricted_annotation' | 'public_release';

export function permitsSharing(consent: ConsentRecord | null, category: SharingCategory, at = new Date()): boolean {
  if (!consent || !canRecord(consent, at)) return false;
  if (category === 'internal_research') return consent.internalResearch;
  if (category === 'restricted_annotation') return consent.restrictedAnnotation;
  return consent.publicRelease;
}
