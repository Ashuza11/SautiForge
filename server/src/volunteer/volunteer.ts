import { z } from 'zod';

/** Two different people are the minimum to compare versions. */
export const REQUIRED_TRANSCRIPTS = 2;
/** A clip stays open to volunteers until the admin decides it, or until this many people have written it. */
export const MAX_TRANSCRIPTS_PER_CLIP = 5;
export const MAX_TRANSCRIPT_LENGTH = 1000;

/** Nicknames only. They are shown to admins, so asking for a real name would be a privacy risk. */
export const pseudonymSchema = z.string()
  .transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'Use at least 2 letters.').max(40, 'Use at most 40 characters.'));

export const linkSchema = z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{24}$/, 'This link is not valid.');
export const contributorTokenSchema = z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{24}$/, 'Open your link again to sign in.');

/** A transcript is one line of text: tidy spaces, no control characters. */
export const transcriptTextSchema = z.string()
  // eslint-disable-next-line no-control-regex
  .transform((value) => value.normalize('NFC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Write what you hear first.').max(MAX_TRANSCRIPT_LENGTH, `Please keep it under ${MAX_TRANSCRIPT_LENGTH} characters.`));

/** The optional note: the form the volunteer thinks is correct. Empty means none. */
export const correctionTextSchema = z.string()
  // eslint-disable-next-line no-control-regex
  .transform((value) => value.normalize('NFC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().max(MAX_TRANSCRIPT_LENGTH, `Please keep it under ${MAX_TRANSCRIPT_LENGTH} characters.`))
  .transform((value) => (value === '' ? undefined : value));

/** `sameAsExisting` is the volunteer saying "yes, that nickname is me" after being told it already exists. */
export const joinSchema = z.object({ link: linkSchema, pseudonym: pseudonymSchema, sameAsExisting: z.boolean().optional() }).strict();
export const sessionSchema = z.object({ link: linkSchema, contributor: contributorTokenSchema }).strict();
export const infoSchema = z.object({ link: linkSchema }).strict();
export const listenSchema = z.object({ link: linkSchema, clipId: z.string().uuid() }).strict();
export const submitSchema = sessionSchema.extend({ clipId: z.string().uuid(), text: transcriptTextSchema, correction: correctionTextSchema.optional() }).strict();
export const skipSchema = sessionSchema.extend({ clipId: z.string().uuid() }).strict();

export type Contributor = { id: string; projectId: string; pseudonym: string; createdAt: string };
export type Submission = {
  id: string;
  clipId: string;
  batchId: string;
  contributorId: string;
  kind: 'transcript' | 'skip';
  text: string | null;
  /** What the volunteer thinks the correct form is, kept apart from what they heard. */
  correction?: string | null;
  createdAt: string;
};
export type NextClip = { clipId: string; position: number; durationMs: number };
