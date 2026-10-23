import { describe, expect, it } from 'vitest';

import type { Project, ProjectDraft } from '../../../src/features/projects/domain/project';
import type { ProjectRepository } from '../projects/project-repository';
import { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import { createServerApp } from './app';

const adminToken = 'test-admin-token-that-is-long-enough';
const projectId = '00000000-0000-4000-8000-000000000001';
const draft: ProjectDraft = {
  title: 'Mashi Community Speech Pilot',
  description: 'Permission-cleared audio only.',
  targetLanguage: 'Shi',
  languageCode: 'shr',
  languageVariety: 'Mashi',
  researchDomain: 'General speech',
  collectionLocation: 'South Kivu, DRC',
  protocolVersion: '2.0',
  annotationProfile: 'verbatim_transcription',
  status: 'active',
};

class MemoryProjectRepository implements ProjectRepository {
  projects = new Map<string, Project>();
  async list(includeArchived: boolean) {
    return [...this.projects.values()].filter((project) => includeArchived || project.status === 'active');
  }
  async getById(id: string) { return this.projects.get(id) ?? null; }
  async create(project: Project) { this.projects.set(project.id, project); return project; }
  async update(project: Project) { this.projects.set(project.id, project); return project; }
  async archive(id: string, updatedAt: string) {
    const project = this.projects.get(id);
    if (!project) return null;
    const archived: Project = { ...project, status: 'archived', updatedAt };
    this.projects.set(id, archived);
    return archived;
  }
  async ping() {}
}

function testApp(ready = true) {
  const repository = new MemoryProjectRepository();
  const projects = new ProjectService(repository, {
    idFactory: () => projectId,
    now: () => new Date('2026-10-24T08:00:00.000Z'),
  });
  const readiness = { check: async () => ({ ready }) } as ReadinessService;
  return {
    app: createServerApp({
      projects,
      readiness,
      adminApiToken: adminToken,
      webOrigin: 'https://annotation.example.org',
    }),
    repository,
  };
}

function adminHeaders(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${adminToken}`, ...extra };
}

describe('SautiForge server API', () => {
  it('exposes a public liveness route without infrastructure details', async () => {
    const response = await testApp().app.request('/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('protects admin routes with the server-held token', async () => {
    const app = testApp().app;
    expect((await app.request('/v1/admin/projects')).status).toBe(401);
    expect((await app.request('/v1/admin/projects', { headers: { Authorization: 'Bearer wrong-token' } })).status).toBe(401);
    expect((await app.request('/v1/admin/projects', { headers: adminHeaders() })).status).toBe(200);
  });

  it('rejects browser calls from origins other than the configured web application', async () => {
    const response = await testApp().app.request('/v1/admin/projects', {
      headers: adminHeaders({ Origin: 'https://attacker.example' }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'origin_not_allowed' });
  });

  it('creates, lists, updates, and softly archives a validated project', async () => {
    const app = testApp().app;
    const created = await app.request('/v1/admin/projects', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(draft),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).project).toMatchObject({ id: projectId, languageCode: 'shr' });

    const listed = await app.request('/v1/admin/projects', { headers: adminHeaders() });
    expect((await listed.json()).projects).toHaveLength(1);

    const updated = await app.request(`/v1/admin/projects/${projectId}`, {
      method: 'PUT',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...draft, title: 'Updated Mashi pilot' }),
    });
    expect((await updated.json()).project.title).toBe('Updated Mashi pilot');

    const archived = await app.request(`/v1/admin/projects/${projectId}/archive`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    expect((await archived.json()).project.status).toBe('archived');
    expect((await (await app.request('/v1/admin/projects', { headers: adminHeaders() })).json()).projects).toEqual([]);
    expect((await (await app.request('/v1/admin/projects?includeArchived=true', { headers: adminHeaders() })).json()).projects).toHaveLength(1);
  });

  it('returns clear validation errors without storing invalid projects', async () => {
    const { app, repository } = testApp();
    const response = await app.request('/v1/admin/projects', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...draft, languageCode: 'Mashi' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'validation_error' });
    expect(repository.projects.size).toBe(0);
  });

  it('rejects oversized administration requests before parsing them', async () => {
    const response = await testApp().app.request('/v1/admin/projects', {
      method: 'POST',
      headers: adminHeaders({
        'Content-Type': 'application/json',
        'Content-Length': String(70 * 1024),
      }),
      body: 'x'.repeat(70 * 1024),
    });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'request_too_large' });
  });

  it('reports readiness without leaking database or bucket error details', async () => {
    const response = await testApp(false).app.request('/v1/admin/ready', { headers: adminHeaders() });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'not_ready' });
  });
});
