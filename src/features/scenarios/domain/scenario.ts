import { z } from 'zod';

export const collectionMethodSchema = z.enum([
  'elicited_prompt',
  'role_play',
  'guided_interview',
  'naturalistic',
  'other',
]);

export const scenarioSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().trim().min(1, 'Title is required').max(160),
  description: z.string().trim().max(2000),
  collectionInstructions: z.string().trim().min(1, 'Collection instructions are required').max(4000),
  expectedIntent: z.string().trim().min(1, 'Expected intent is required').max(160),
  collectionMethod: collectionMethodSchema,
  version: z.string().trim().min(1, 'Version is required').max(40),
  referenceData: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  status: z.enum(['active', 'archived']),
});

export const scenarioDraftSchema = scenarioSchema.omit({
  id: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioDraft = z.infer<typeof scenarioDraftSchema>;
