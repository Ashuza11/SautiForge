import { z } from 'zod';

export const MAX_SOURCE_MEDIA_BYTES = 5 * 1024 * 1024 * 1024;

const contributorCodeSchema = z.string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/, 'Use a pseudonymous administrator code.');

export const sourceMediaUploadDraftSchema = z.object({
  fileName: z.string()
    .trim()
    .min(1, 'A source filename is required.')
    .max(255)
    .refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value), 'Use a filename without paths or control characters.'),
  contentType: z.string()
    .trim()
    .toLowerCase()
    .max(120)
    .regex(/^(audio|video)\/[a-z0-9][a-z0-9.+-]*$/, 'Only audio or video media types are supported.'),
  sizeBytes: z.number().int().positive().max(MAX_SOURCE_MEDIA_BYTES),
  sha256: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/, 'Use a 64-character hexadecimal SHA-256 digest.'),
  createdBy: contributorCodeSchema,
}).strict();

export const sourceMediaStatusSchema = z.enum([
  'upload_pending',
  'verified',
  'verification_failed',
]);

export const sourceMediaSchema = sourceMediaUploadDraftSchema.safeExtend({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
  rightsRevision: z.number().int().positive(),
  objectKey: z.string().min(1).max(1024),
  status: sourceMediaStatusSchema,
  verificationError: z.string().max(80).nullable(),
  uploadExpiresAt: z.string().datetime({ offset: true }),
  verifiedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type SourceMediaUploadDraft = z.infer<typeof sourceMediaUploadDraftSchema>;
export type SourceMedia = z.infer<typeof sourceMediaSchema>;
export type SourceMediaStatus = z.infer<typeof sourceMediaStatusSchema>;
