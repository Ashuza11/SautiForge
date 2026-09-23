import { z } from 'zod';

export const localSettingsSchema = z.object({
  activeProjectId: z.string().uuid().nullable(),
}).strict();

export type LocalSettings = z.infer<typeof localSettingsSchema>;

export const storageRecoveryReportSchema = z.object({
  checkedAt: z.string().datetime({ offset: true }),
  scannedFiles: z.number().int().nonnegative(),
  verifiedFiles: z.number().int().nonnegative(),
  quarantinedPaths: z.array(z.string()),
  missingPaths: z.array(z.string()),
  errors: z.array(z.string()),
});

export type StorageRecoveryReport = z.infer<typeof storageRecoveryReportSchema>;
