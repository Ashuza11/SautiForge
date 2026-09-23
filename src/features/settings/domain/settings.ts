import { z } from 'zod';

export const localSettingsSchema = z.object({
  activeProjectId: z.string().uuid().nullable(),
}).strict();

export type LocalSettings = z.infer<typeof localSettingsSchema>;
