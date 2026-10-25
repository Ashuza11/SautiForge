import { z } from 'zod';

export const sourceTypeSchema = z.enum([
  'youtube_reference',
  'external_url',
  'authorized_upload',
  'creator_provided',
  'sautiforge_recording',
]);

export const sourceStatusSchema = z.enum([
  'candidate',
  'language_unverified',
  'permission_pending',
  'approved',
  'rejected',
  'revoked',
]);

export const languageVerificationSchema = z.enum([
  'unverified',
  'verified_target',
  'mixed_target',
  'wrong_language',
]);

export const speakerIdentificationSchema = z.enum([
  'not_assessed',
  'unknown',
  'partially_verified',
  'verified',
]);

export const sourceMetadataDraftSchema = z.object({
  sourceType: sourceTypeSchema,
  title: z.string().trim().min(1, 'Source title is required.').max(240),
  originalUrl: z.string().trim().url().max(2000).refine((value) => value.startsWith('https://'), 'Source URLs must use HTTPS.').nullable(),
  creator: z.string().trim().max(240).nullable(),
  sourceDate: z.string().date().nullable(),
  durationMs: z.number().int().positive().max(24 * 60 * 60 * 1000).nullable(),
  externalReference: z.string().trim().max(240).nullable(),
  languageVerification: languageVerificationSchema,
  languageVerifiedBy: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/, 'Use a pseudonymous reviewer code.').nullable(),
  languageVerificationNotes: z.string().trim().max(2000),
  speakerIdentification: speakerIdentificationSchema,
  speakerNotes: z.string().trim().max(2000),
}).strict().superRefine((value, context) => {
  if (['youtube_reference', 'external_url'].includes(value.sourceType) && !value.originalUrl) {
    context.addIssue({
      code: 'custom',
      path: ['originalUrl'],
      message: 'A discovery URL is required for URL-based sources.',
    });
  }
  if (value.sourceType === 'sautiforge_recording' && !value.externalReference) {
    context.addIssue({
      code: 'custom',
      path: ['externalReference'],
      message: 'A SautiForge recording reference is required.',
    });
  }
  if (value.languageVerification !== 'unverified' && !value.languageVerifiedBy) {
    context.addIssue({
      code: 'custom',
      path: ['languageVerifiedBy'],
      message: 'Record the pseudonymous reviewer code for a language decision.',
    });
  }
});

export const sourceCandidateBatchSchema = z.array(sourceMetadataDraftSchema).min(1).max(100);

export const sourceSchema = sourceMetadataDraftSchema.safeExtend({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: sourceStatusSchema,
  rightsRevision: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const authorizedUsesSchema = z.object({
  internalProcessing: z.boolean(),
  volunteerAccess: z.boolean(),
  transcription: z.boolean(),
  mlResearch: z.boolean(),
  publicDistribution: z.boolean(),
}).strict();

export const rightsDecisionSchema = z.enum(['pending', 'approved', 'rejected', 'revoked']);

export const sourceRightsDraftSchema = z.object({
  rightsHolder: z.string().trim().max(240).nullable(),
  license: z.string().trim().max(240).nullable(),
  permissionEvidence: z.string().trim().max(2000).nullable(),
  attributionRequirements: z.string().trim().max(2000).nullable(),
  authorizedUses: authorizedUsesSchema,
  decision: rightsDecisionSchema,
  changedBy: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/, 'Use a pseudonymous administrator code.'),
  changeReason: z.string().trim().min(1, 'Explain why the rights decision changed.').max(2000),
}).strict().superRefine((value, context) => {
  const allowedUseCount = Object.values(value.authorizedUses).filter(Boolean).length;
  if (value.decision === 'approved') {
    if (!value.rightsHolder) {
      context.addIssue({ code: 'custom', path: ['rightsHolder'], message: 'An approved source requires a rights holder.' });
    }
    if (!value.permissionEvidence) {
      context.addIssue({ code: 'custom', path: ['permissionEvidence'], message: 'An approved source requires permission evidence.' });
    }
    if (allowedUseCount === 0) {
      context.addIssue({ code: 'custom', path: ['authorizedUses'], message: 'Approve at least one specific use.' });
    }
  }
  if (['rejected', 'revoked'].includes(value.decision) && allowedUseCount > 0) {
    context.addIssue({
      code: 'custom',
      path: ['authorizedUses'],
      message: 'Rejected or revoked rights cannot authorize any use.',
    });
  }
});

export const sourceRightsRevisionSchema = sourceRightsDraftSchema.safeExtend({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
});

export type Source = z.infer<typeof sourceSchema>;
export type SourceMetadataDraft = z.infer<typeof sourceMetadataDraftSchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type AuthorizedUses = z.infer<typeof authorizedUsesSchema>;
export type AuthorizedUse = keyof AuthorizedUses;
export type SourceRightsDraft = z.infer<typeof sourceRightsDraftSchema>;
export type SourceRightsRevision = z.infer<typeof sourceRightsRevisionSchema>;

export const NO_AUTHORIZED_USES: AuthorizedUses = {
  internalProcessing: false,
  volunteerAccess: false,
  transcription: false,
  mlResearch: false,
  publicDistribution: false,
};
