import { describe, expect, it } from 'vitest';

import type { ProjectDraft } from '../../../src/features/projects/domain/project';
import { LocalProjectWorkspaceRepository, projectTemplateSchema, serializeProjectTemplate, type ProjectStorage } from './project-workspace';

const projectId = '8246c28f-9576-4e0b-88fd-cb8689a71133';
const createdAt = new Date('2026-10-22T08:00:00.000Z');

const draft: ProjectDraft = {
  title: 'Mashi Community Speech Pilot',
  description: 'Permission-cleared community transcription.',
  targetLanguage: 'Shi',
  languageCode: 'shr',
  languageVariety: 'Mashi',
  researchDomain: 'General speech transcription',
  collectionLocation: 'South Kivu, DRC',
  protocolVersion: '0.2',
  annotationProfile: 'verbatim_transcription',
  status: 'active',
};

describe('local web project workspace', () => {
  it('creates, verifies, edits, archives and exports a language-independent project', () => {
    const repository = new LocalProjectWorkspaceRepository(new MemoryStorage(), () => projectId, () => createdAt);
    const created = repository.create(draft);
    expect(created).toMatchObject({ id: projectId, languageCode: 'shr', annotationProfile: 'verbatim_transcription' });
    expect(repository.list()).toEqual([created]);

    const updated = repository.update(projectId, { ...draft, title: 'Edited project', targetLanguage: 'Lega', languageCode: 'lea', languageVariety: 'Shabunda' });
    expect(updated).toMatchObject({ title: 'Edited project', targetLanguage: 'Lega', languageCode: 'lea' });
    expect(projectTemplateSchema.parse(JSON.parse(serializeProjectTemplate(updated))).project.id).toBe(projectId);

    expect(repository.archive(projectId).status).toBe('archived');
    expect(repository.list()).toEqual([]);
    expect(repository.list(true)).toHaveLength(1);
  });

  it('rejects invalid ISO codes and unsupported annotation workflows', () => {
    const repository = new LocalProjectWorkspaceRepository(new MemoryStorage(), () => projectId, () => createdAt);
    expect(() => repository.create({ ...draft, languageCode: 'shi-mashi' })).toThrow();
    expect(() => repository.create({ ...draft, annotationProfile: 'mashi_only' as never })).toThrow();
  });

  it('does not claim a project was saved when storage silently ignores the write', () => {
    const repository = new LocalProjectWorkspaceRepository(new SilentStorage(), () => projectId, () => createdAt);
    expect(() => repository.create(draft)).toThrow(/not readable after saving/);
  });
});

class MemoryStorage implements ProjectStorage {
  private value: string | null = null;
  getItem() { return this.value; }
  setItem(_key: string, value: string) { this.value = value; }
}

class SilentStorage implements ProjectStorage {
  getItem() { return null; }
  setItem() {}
}
