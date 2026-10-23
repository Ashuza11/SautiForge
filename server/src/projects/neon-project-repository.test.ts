import { describe, expect, it, vi } from 'vitest';

import type { Project } from '../../../src/features/projects/domain/project';
import type { SqlExecutor } from '../database/neon';
import { NeonProjectRepository } from './neon-project-repository';

const project: Project = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Mashi Community Speech Pilot',
  description: 'General transcription project',
  targetLanguage: 'Shi',
  languageCode: 'shr',
  languageVariety: 'Mashi',
  researchDomain: 'General speech',
  collectionLocation: 'South Kivu, DRC',
  protocolVersion: '2.0',
  annotationProfile: 'verbatim_transcription',
  status: 'active',
  createdAt: '2026-10-24T08:00:00.000Z',
  updatedAt: '2026-10-24T08:00:00.000Z',
};

const row = {
  id: project.id,
  title: project.title,
  description: project.description,
  target_language: project.targetLanguage,
  language_code: project.languageCode,
  language_variety: project.languageVariety,
  research_domain: project.researchDomain,
  collection_location: project.collectionLocation,
  protocol_version: project.protocolVersion,
  annotation_profile: project.annotationProfile,
  status: project.status,
  created_at: new Date(project.createdAt),
  updated_at: new Date(project.updatedAt),
};

describe('NeonProjectRepository', () => {
  it('maps PostgreSQL rows into the shared project contract', async () => {
    const database: SqlExecutor = { query: vi.fn().mockResolvedValue([row]) };
    const repository = new NeonProjectRepository(database);
    await expect(repository.list(false)).resolves.toEqual([project]);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("status = 'active'"), [false]);
  });

  it('uses placeholders for project values and returns the verified row', async () => {
    const query = vi.fn().mockResolvedValue([row]);
    const repository = new NeonProjectRepository({ query });
    await expect(repository.create(project)).resolves.toEqual(project);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('$1');
    expect(sql).not.toContain(project.title);
    expect(values).toContain(project.title);
    expect(values).toContain('shr');
  });

  it('returns null when update or archive targets do not exist', async () => {
    const repository = new NeonProjectRepository({ query: vi.fn().mockResolvedValue([]) });
    await expect(repository.update(project)).resolves.toBeNull();
    await expect(repository.archive(project.id, project.updatedAt)).resolves.toBeNull();
    await expect(repository.getById(project.id)).resolves.toBeNull();
  });

  it('fails closed when persisted data violates the shared schema', async () => {
    const repository = new NeonProjectRepository({
      query: vi.fn().mockResolvedValue([{ ...row, language_code: 'mashi' }]),
    });
    await expect(repository.list(true)).rejects.toThrow();
  });
});
