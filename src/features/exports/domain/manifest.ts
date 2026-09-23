import { z } from 'zod';

export const EXPORT_SCHEMA_VERSION = '1.0.0';

export const manifestFileSchema = z.object({
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const exportManifestSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportId: z.string().uuid(),
  exportType: z.enum(['research_dataset', 'administrative_backup']),
  exportedAt: z.string().datetime({ offset: true }),
  app: z.literal('SautiForge'),
  databaseVersion: z.number().int().positive(),
  projectId: z.string().uuid().nullable(),
  sharingCategory: z.enum(['internal_research', 'restricted_annotation', 'public_release']).nullable(),
  sensitiveAdministrativeData: z.boolean(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  files: z.array(manifestFileSchema),
});

export type ExportManifest = z.infer<typeof exportManifestSchema>;

export function validateRelativeArchivePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.startsWith('\\') && !path.includes('..') && !path.includes('\\');
}

export function validateManifestReferences(manifest: ExportManifest, audioReferences: string[]): void {
  const parsed = exportManifestSchema.parse(manifest);
  const manifestPaths = new Set(parsed.files.map((file) => file.path));
  for (const file of parsed.files) {
    if (!validateRelativeArchivePath(file.path)) throw new Error(`Unsafe archive path: ${file.path}`);
  }
  for (const reference of audioReferences) {
    if (!validateRelativeArchivePath(reference) || !manifestPaths.has(reference)) {
      throw new Error(`Manifest does not contain referenced audio file: ${reference}`);
    }
  }
}
