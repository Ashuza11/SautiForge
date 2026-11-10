import { describe, expect, it, vi } from 'vitest';

import type { BatchService } from '../batches/batch-service';
import type { ClipService } from '../clips/clip-service';
import type { SourceMediaService } from '../media/source-media-service';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import type { SourceService } from '../sources/source-service';
import { VolunteerError, type VolunteerService } from '../volunteer/volunteer-service';
import { createServerApp } from './app';

const link = `${'0'.repeat(8)}-0000-4000-8000-000000000901.${'c'.repeat(24)}`;
const contributor = `${'1'.repeat(8)}-0000-4000-8000-000000000701.${'d'.repeat(24)}`;
const clipId = '00000000-0000-4000-8000-000000000401';

function volunteerApp() {
  const volunteer = {
    info: vi.fn().mockResolvedValue({ title: 'Batch 1', clipCount: 5, language: 'Mashi' }),
    join: vi.fn().mockResolvedValue({ contributor: { id: 'x', pseudonym: 'Neema' }, token: 't' }),
    next: vi.fn().mockResolvedValue({ clip: null, progress: { total: 5, answered: 5 } }),
    submit: vi.fn().mockResolvedValue('recorded'),
    skip: vi.fn().mockResolvedValue('recorded'),
  } as unknown as VolunteerService;
  const app = createServerApp({
    projects: {} as ProjectService, sources: {} as SourceService, media: {} as SourceMediaService, clips: {} as ClipService,
    batches: {} as BatchService, volunteer, readiness: {} as ReadinessService,
    adminApiToken: 'test-admin-token-that-is-long-enough', webOrigin: 'https://annotation.example.org',
  });
  const post = (path: string, body: unknown) => app.request(`/v1/volunteer/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { post, volunteer, app };
}

describe('volunteer routes', () => {
  it('are public: no admin credentials needed, but admin routes stay closed', async () => {
    const { post, app } = volunteerApp();
    expect((await post('info', { link })).status).toBe(200);
    expect((await app.request('/v1/admin/projects')).status).toBe(401);
  });

  it('validates every body before the service is called', async () => {
    const { post, volunteer } = volunteerApp();
    expect((await post('info', { link: 'nope' })).status).toBe(400);
    expect((await post('join', { link, pseudonym: 'x' })).status).toBe(400);
    expect((await post('join', { link, pseudonym: 'Neema', extra: 1 })).status).toBe(400);
    expect((await post('next', { link, contributor: 'bad' })).status).toBe(400);
    expect((await post('submit', { link, contributor, clipId, text: '   ' })).status).toBe(400);
    expect((await post('submit', { link, contributor, clipId: 'nope', text: 'a' })).status).toBe(400);
    expect((await post('submit', { link, contributor, clipId, text: 'a'.repeat(1001) })).status).toBe(400);
    expect(volunteer.submit).not.toHaveBeenCalled();
  });

  it('cleans the text and the nickname before they reach the service', async () => {
    const { post, volunteer } = volunteerApp();
    expect((await post('join', { link, pseudonym: '  Mama   Neema ' })).status).toBe(201);
    expect(volunteer.join).toHaveBeenCalledWith(link, 'Mama Neema');
    await post('submit', { link, contributor, clipId, text: ' mwana\n wa   Mashi\t' });
    expect(volunteer.submit).toHaveBeenCalledWith(link, contributor, clipId, 'mwana wa Mashi');
    expect((await post('skip', { link, contributor, clipId })).status).toBe(200);
  });

  it('maps errors to 404, 401 and 409, and caps the request size', async () => {
    const { post, volunteer } = volunteerApp();
    vi.mocked(volunteer.next).mockRejectedValueOnce(new VolunteerError('link_invalid', 'closed'));
    expect((await post('next', { link, contributor })).status).toBe(404);
    vi.mocked(volunteer.next).mockRejectedValueOnce(new VolunteerError('contributor_invalid', 'again'));
    expect((await post('next', { link, contributor })).status).toBe(401);
    vi.mocked(volunteer.submit).mockRejectedValueOnce(new VolunteerError('clip_unavailable', 'gone'));
    expect((await post('submit', { link, contributor, clipId, text: 'a' })).status).toBe(409);
    expect((await post('info', { link, filler: 'a'.repeat(9000) })).status).toBe(413);
  });
});
