import { describe, expect, it, vi } from 'vitest';

import type { CollectionSession } from '../domain/session';
import { SQLiteSessionRepository } from './sqlite-session-repository';

vi.mock('@/domain/common', () => ({
  newId: () => 'de0a9676-92cc-4b18-997a-3fafce18b700',
  nowIso: () => '2026-09-26T10:00:00.000+02:00',
}));

const completed: CollectionSession = {
  id: '7a2c5300-f90d-49b6-8592-348787011e0f',
  projectId: 'f75fb042-bd31-4f16-a1b7-26ab4764e817',
  participantId: '4a63d3ed-5016-4512-91e2-36342d412f19',
  consentRecordId: 'e8047f61-d626-4b05-b163-48346bc6aecb',
  startedAt: '2026-09-26T08:00:00.000+02:00',
  endedAt: '2026-09-26T09:00:00.000+02:00',
  deviceMetadata: { platform: 'android' },
  collectionEnvironment: 'Indoor shop',
  city: 'Bukavu',
  researcherNotes: null,
  status: 'completed',
  createdAt: '2026-09-26T08:00:00.000+02:00',
  updatedAt: '2026-09-26T09:00:00.000+02:00',
};

function repository(consentValid = true, changes = 1) {
  const db = { runAsync: vi.fn().mockResolvedValue({ changes }) };
  const consent = { participantCanRecord: vi.fn().mockResolvedValue(consentValid) };
  const instance = new SQLiteSessionRepository(db as never, consent as never);
  return { instance, db, consent };
}

describe('completed session recovery', () => {
  it('reopens a completed session, clears its end time, and verifies persistence', async () => {
    const { instance, db, consent } = repository();
    const reopened = { ...completed, status: 'in_progress' as const, endedAt: null, updatedAt: '2026-09-26T10:00:00.000+02:00' };
    vi.spyOn(instance, 'get').mockResolvedValueOnce(completed).mockResolvedValueOnce(reopened);

    await expect(instance.reopen(completed.id)).resolves.toEqual(reopened);

    expect(consent.participantCanRecord).toHaveBeenCalledWith(completed.participantId);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("status = 'in_progress', ended_at = NULL"),
      '2026-09-26T10:00:00.000+02:00',
      completed.id,
    );
  });

  it('does not change a completed session without current recording consent', async () => {
    const { instance, db } = repository(false);
    vi.spyOn(instance, 'get').mockResolvedValue(completed);

    await expect(instance.reopen(completed.id)).rejects.toThrow(/consent is not valid/);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('reports a failed conditional update instead of claiming the session reopened', async () => {
    const { instance } = repository(true, 0);
    vi.spyOn(instance, 'get').mockResolvedValue(completed);

    await expect(instance.reopen(completed.id)).rejects.toThrow(/could not be reopened/);
  });
});
