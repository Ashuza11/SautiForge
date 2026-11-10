import { z } from 'zod';

export const MAX_CLIP_AUDIO_BYTES = 20 * 1024 * 1024;

/** `master` is the lossless FLAC kept for the dataset, and what volunteers play. `listening` is an optional small Opus copy. */
export const clipVariantSchema = z.enum(['master', 'listening']);
/** Which processed audio the stored files were encoded from. */
export const clipDerivedFromSchema = z.enum(['original', 'cleaned']);
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

/** The media type each stored role must have. */
export const CONTENT_TYPE_BY_VARIANT = { master: 'audio/flac', listening: 'audio/ogg' } as const;
export const FILE_EXTENSION_BY_VARIANT = { master: 'flac', listening: 'opus' } as const;

export const clipAudioDraftSchema = z.object({
  variant: clipVariantSchema,
  derivedFrom: clipDerivedFromSchema,
  sizeBytes: z.number().int().positive().max(MAX_CLIP_AUDIO_BYTES),
  /** SHA-256 of the stored file itself (what the upload is checked against). */
  sha256: sha256Schema,
  /** SHA-256 of the 16-bit PCM samples the master was encoded from; the export decodes back and checks it. */
  pcmSha256: sha256Schema.nullish().transform((value) => value ?? null),
  sampleRate: z.number().int().min(8000).max(96000),
  durationMs: z.number().int().positive().max(60_000),
}).strict();

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
  if (!variants.includes('master')) {
    context.addIssue({ code: 'custom', path: ['audio'], message: 'The FLAC master is required.' });
  }
  if (new Set(value.audio.map((file) => file.derivedFrom)).size > 1) {
    context.addIssue({ code: 'custom', path: ['audio'], message: 'Both files must come from the same audio.' });
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
  derivedFrom: clipDerivedFromSchema,
  contentType: z.enum(['audio/flac', 'audio/ogg']),
  sizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
  pcmSha256: sha256Schema.nullable(),
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
