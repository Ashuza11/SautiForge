import { describe, expect, it, vi } from 'vitest';

import type { SqlExecutor } from '../database/neon';
import { NeonSourceMediaRepository } from './neon-source-media-repository';
import type { SourceMedia } from './source-media';

const row = {
  id: '00000000-0000-4000-8000-000000000301',
  project_id: '00000000-0000-4000-8000-000000000001',
  source_id: '00000000-0000-4000-8000-000000000101',
  rights_revision: 2,
  object_key: 'projects/project/sources/source/masters/media',
  client_filename: 'master.opus',
  content_type: 'audio/ogg',
  size_bytes: '4096',
  sha256_hex: '00'.repeat(32),
  status: 'upload_pending',
  verification_error: null,
  upload_expires_at: new Date('2026-10-25T10:05:00.000Z'),
  verified_at: null,
  created_by: 'ADMIN-01',
  created_at: new Date('2026-10-25T10:00:00.000Z'),
  updated_at: new Date('2026-10-25T10:00:00.000Z'),
};

const media: SourceMedia = {
  id: row.id,
  projectId: row.project_id,
  sourceId: row.source_id,
  rightsRevision: 2,
  objectKey: row.object_key,
  fileName: row.client_filename,
  contentType: row.content_type,
  sizeBytes: 4096,
  sha256: row.sha256_hex,
  status: 'upload_pending',
  verificationError: null,
  uploadExpiresAt: '2026-10-25T10:05:00.000Z',
  verifiedAt: null,
  createdBy: row.created_by,
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
};

function repositoryWith(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue(rows);
  return { repository: new NeonSourceMediaRepository({ query } as unknown as SqlExecutor), query };
}

describe('NeonSourceMediaRepository', () => {
  it('maps persisted numeric and timestamp values through the runtime schema', async () => {
    const { repository } = repositoryWith([row]);
    await expect(repository.getById(row.id)).resolves.toEqual(media);
  });

  it('creates a pending record only through a current internal-processing permission join', async () => {
    const { repository, query } = repositoryWith([row]);
    await expect(repository.createWhenAuthorized(media)).resolves.toEqual(media);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("rights.allow_internal_processing = TRUE"), [
      media.id,
      media.projectId,
      media.sourceId,
      media.rightsRevision,
      media.objectKey,
      media.fileName,
      media.contentType,
      media.sizeBytes,
      media.sha256,
      media.status,
      media.verificationError,
      media.uploadExpiresAt,
      media.verifiedAt,
      media.createdBy,
      media.createdAt,
      media.updatedAt,
    ]);
    expect(query.mock.calls[0][0]).toContain("project.status = 'active'");
  });

  it('returns null when authorization changed before the insert', async () => {
    const { repository } = repositoryWith([]);
    await expect(repository.createWhenAuthorized(media)).resolves.toBeNull();
  });

  it('updates verification only while the upload is pending and permission remains current', async () => {
    const verifiedRow = {
      ...row,
      status: 'verified',
      verified_at: new Date('2026-10-25T10:01:00.000Z'),
      updated_at: new Date('2026-10-25T10:01:00.000Z'),
    };
    const { repository, query } = repositoryWith([verifiedRow]);
    await expect(repository.updateVerification({
      id: row.id,
      expectedStatus: 'upload_pending',
      status: 'verified',
      verificationError: null,
      verifiedAt: '2026-10-25T10:01:00.000Z',
      updatedAt: '2026-10-25T10:01:00.000Z',
    })).resolves.toMatchObject({ status: 'verified' });
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('media.status = $2');
    expect(sql).toContain("source.status = 'approved'");
    expect(sql).toContain("project.status = 'active'");
    expect(sql).toContain('rights.allow_internal_processing = TRUE');
  });
});
