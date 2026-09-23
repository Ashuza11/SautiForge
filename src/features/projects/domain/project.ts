import { z } from 'zod';

export const projectStatusSchema = z.enum(['active', 'archived']);

export const projectSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, 'Title is required').max(160),
  description: z.string().trim().max(2000),
  targetLanguage: z.string().trim().min(1, 'Target language is required').max(120),
  languageVariety: z.string().trim().min(1, 'Language variety is required').max(120),
  researchDomain: z.string().trim().min(1, 'Research domain is required').max(160),
  collectionLocation: z.string().trim().min(1, 'Collection location is required').max(160),
  protocolVersion: z.string().trim().min(1, 'Protocol version is required').max(40),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  status: projectStatusSchema,
});

export const projectDraftSchema = projectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectDraft = z.infer<typeof projectDraftSchema>;
