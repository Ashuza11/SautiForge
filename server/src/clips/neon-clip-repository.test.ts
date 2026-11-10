import { describe, expect, it, vi } from 'vitest';

import type { SqlExecutor } from '../database/neon';
import { NeonClipRepository } from './neon-clip-repository';

function executor(rows: Record<string, unknown>[][] = []) {
  const query = vi.fn();
  for (const result of rows) query.mockResolvedValueOnce(result);
  query.mockResolvedValue([]);
  return { database: { query } as unknown as SqlExecutor, query };
}

const clipRow = {
  id: '00000000-0000-4000-8000-000000000401',
  project_id: '00000000-0000-4000-8000-000000000001',
  source_id: '00000000-0000-4000-8000-000000000101',
  rights_revision: 2,
  clip_key: 'c001',
  start_ms: 0,
  end_ms: 3000,
  trimmed_ms: 0,
  duration_ms: 3000,
  speaker_role: 'narrator',
  speaker_name: null,
  has_music: false,
  tier: 'asr',
  status: 'published',
  segmenter: null,
  created_by: 'ADMIN-01',
  created_at: new Date('2026-11-07T10:00:00.000Z'),
  updated_at: new Date('2026-11-07T10:00:00.000Z'),
  published_at: new Date('2026-11-07T10:00:00.000Z'),
  withdrawn_at: null,
};

describe('NeonClipRepository', () => {
  it('maps rows and attaches audio files in one extra query', async () => {
    const { database, query } = executor([[clipRow], [{
      id: '00000000-0000-4000-8000-000000000501',
      clip_id: clipRow.id,
      variant: 'master',
      derived_from: 'cleaned',
      object_key: 'k',
      content_type: 'audio/flac',
      size_bytes: 10,
      sha256_hex: 'a'.repeat(64),
      pcm_sha256_hex: 'b'.repeat(64),
      sample_rate: 24000,
      duration_ms: 3000,
      status: 'verified',
      verification_error: null,
      upload_expires_at: new Date('2026-11-07T10:05:00.000Z'),
      verified_at: new Date('2026-11-07T10:01:00.000Z'),
      created_at: new Date('2026-11-07T10:00:00.000Z'),
      updated_at: new Date('2026-11-07T10:01:00.000Z'),
    }]]);
    const [item] = await new NeonClipRepository(database).listForSource(clipRow.source_id, 'published');
    expect(item.clip).toMatchObject({ clipKey: 'c001', publishedAt: '2026-11-07T10:00:00.000Z', speakerName: null });
    expect(item.files).toHaveLength(1);
    expect(item.files[0]).toMatchObject({ variant: 'master', derivedFrom: 'cleaned', contentType: 'audio/flac', pcmSha256: 'b'.repeat(64) });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('guards every write with the source rights check', async () => {
    const { database, query } = executor();
    const repo = new NeonClipRepository(database);
    const id = clipRow.id;
    await repo.updateMetadata(id, { speakerRole: 'narrator', speakerName: null, hasMusic: false, tier: 'asr', segmenter: null }, 'x');
    await repo.resetFile({ id, sizeBytes: 1, sha256: 'a'.repeat(64), sampleRate: 24000, durationMs: 1, uploadExpiresAt: 'x', updatedAt: 'x', derivedFrom: 'cleaned', pcmSha256: null } as never);
    await repo.updateFileVerification({ id, status: 'verified', verificationError: null, verifiedAt: 'x', updatedAt: 'x' });
    await repo.publish(id, 'x');
    const sql = query.mock.calls.map(([text]) => text as string);
    for (const text of sql) {
      expect(text).toContain("r.decision = 'approved'");
      expect(text).toContain("p.status = 'active'");
    }
    expect(sql[1]).toContain("f.status <> 'verified'");
    expect(sql[3]).toContain('allow_volunteer_access');
    expect(sql[3]).toContain('allow_transcription');
    expect(sql[3]).toContain("f.variant = 'listening' AND f.status = 'verified'");
  });
});
