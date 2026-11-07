import { z } from 'zod';

export const MAX_CLIP_AUDIO_BYTES = 20 * 1024 * 1024;

export const clipVariantSchema = z.enum(['original', 'vocals_htdemucs']);
export const clipSpeakerRoleSchema = z.enum(['narrator', 'character', 'multiple', 'unknown']);
export const clipTierSchema = z.enum(['asr', 'asr_tts']);
export const clipStatusSchema = z.enum(['draft', 'published', 'withdrawn']);
export const clipAudioStatusSchema = z.enum(['upload_pending', 'verified', 'verification_failed']);

const sha256Schema = z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/, 'Use a 64-character hexadecimal SHA-256 digest.');

const adminCodeSchema = z.string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/, 'Use a pseudonymous administrator code.');

export const clipAudioDraftSchema = z.object({
  variant: clipVariantSchema,
  sizeBytes: z.number().int().positive().max(MAX_CLIP_AUDIO_BYTES),
  sha256: sha256Schema,
  sampleRate: z.number().int().min(8000).max(96000),
  durationMs: z.number().int().positive().max(60_000),
}).strict();

/** The cleaned (music-removed) copy is what volunteers hear, so it is required. */
export const CLEANED_VARIANT = 'vocals_htdemucs' as const;

export const clipDraftSchema = z.object({
  clipKey: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Use letters, digits, dash or underscore (max 40).'),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
  trimmedMs: z.number().int().min(0).default(0),
  durationMs: z.number().int().positive().max(60_000),
  speakerRole: clipSpeakerRoleSchema,
  speakerName: z.string().trim().max(80).nullish().transform((value) => value || null),
  hasMusic: z.boolean(),
  tier: clipTierSchema,
  segmenter: z.string().trim().max(80).nullish().transform((value) => value || null),
  createdBy: adminCodeSchema,
  audio: z.array(clipAudioDraftSchema).min(1).max(2),
}).strict().superRefine((value, context) => {
  if (value.endMs <= value.startMs) {
    context.addIssue({ code: 'custom', path: ['endMs'], message: 'The clip must end after it starts.' });
  }
  if (value.tier === 'asr_tts' && value.hasMusic) {
    context.addIssue({ code: 'custom', path: ['tier'], message: 'A clip with music cannot be in the TTS tier.' });
  }
  const variants = value.audio.map((file) => file.variant);
  if (new Set(variants).size !== variants.length) {
    context.addIssue({ code: 'custom', path: ['audio'], message: 'Each audio variant can appear only once.' });
  }
  if (!variants.includes(CLEANED_VARIANT)) {
    context.addIssue({ code: 'custom', path: ['audio'], message: 'The cleaned audio variant is required.' });
  }
  for (const [index, file] of value.audio.entries()) {
    if (file.durationMs > value.durationMs + 100) {
      context.addIssue({ code: 'custom', path: ['audio', index, 'durationMs'], message: 'Audio is longer than the clip.' });
    }
  }
});

export const clipSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
  rightsRevision: z.number().int().positive(),
  clipKey: z.string(),
  startMs: z.number().int(),
  endMs: z.number().int(),
  trimmedMs: z.number().int(),
  durationMs: z.number().int(),
  speakerRole: clipSpeakerRoleSchema,
  speakerName: z.string().nullable(),
  hasMusic: z.boolean(),
  tier: clipTierSchema,
  status: clipStatusSchema,
  segmenter: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  withdrawnAt: z.string().datetime({ offset: true }).nullable(),
});

export const clipAudioFileSchema = z.object({
  id: z.string().uuid(),
  clipId: z.string().uuid(),
  variant: clipVariantSchema,
  objectKey: z.string().min(1).max(1024),
  contentType: z.literal('audio/wav'),
  sizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
  sampleRate: z.number().int(),
  durationMs: z.number().int(),
  status: clipAudioStatusSchema,
  verificationError: z.string().max(80).nullable(),
  uploadExpiresAt: z.string().datetime({ offset: true }),
  verifiedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ClipDraft = z.infer<typeof clipDraftSchema>;
export type ClipAudioDraft = z.infer<typeof clipAudioDraftSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type ClipAudioFile = z.infer<typeof clipAudioFileSchema>;
export type ClipVariant = z.infer<typeof clipVariantSchema>;
export type ClipStatus = z.infer<typeof clipStatusSchema>;
export type ClipWithFiles = { clip: Clip; files: ClipAudioFile[] };
