import { describe, expect, it, vi } from 'vitest';

import type { BatchService } from '../batches/batch-service';
import type { ClipService } from '../clips/clip-service';
import type { SourceMediaService } from '../media/source-media-service';
import type { ProjectService } from '../projects/project-service';
import type { ReadinessService } from '../readiness';
import type { SourceService } from '../sources/source-service';
import { VolunteerError, type VolunteerService } from '../volunteer/volunteer-service';
import type { FinalService } from '../finals/final-service';
import type { ResultsService } from '../results/results-service';
import { createServerApp } from './app';

const link = `${'0'.repeat(8)}-0000-4000-8000-000000000901.${'c'.repeat(24)}`;
const contributor = `${'1'.repeat(8)}-0000-4000-8000-000000000701.${'d'.repeat(24)}`;
const clipId = '00000000-0000-4000-8000-000000000401';

function volunteerApp(volunteerRateLimit?: { allow(key: string): boolean }) {
  const volunteer = {
    info: vi.fn().mockResolvedValue({ title: 'Batch 1', clipCount: 5, language: 'Mashi' }),
    join: vi.fn().mockResolvedValue({ contributor: { id: 'x', pseudonym: 'Neema' }, token: 't' }),
    next: vi.fn().mockResolvedValue({ clip: null, progress: { total: 5, answered: 5 } }),
    submit: vi.fn().mockResolvedValue('recorded'),
    skip: vi.fn().mockResolvedValue('recorded'),
    listen: vi.fn().mockResolvedValue({ position: 1, clipCount: 5, audioUrl: 'https://storage.example/a' }),
  } as unknown as VolunteerService;
  const app = createServerApp({
    projects: {} as ProjectService, sources: {} as SourceService, media: {} as SourceMediaService, clips: {} as ClipService,
    batches: {} as BatchService, volunteer, results: {} as ResultsService, finals: {} as FinalService, readiness: {} as ReadinessService,
    adminApiToken: 'test-admin-token-that-is-long-enough', webOrigin: 'https://annotation.example.org', volunteerRateLimit,
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

  it('lets a visitor hear one clip with the batch link alone, and validates the body', async () => {
    const { post, volunteer } = volunteerApp();
    const response = await post('listen', { link, clipId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ position: 1, clipCount: 5, audioUrl: 'https://storage.example/a' });
    expect((await post('listen', { link, clipId: 'nope' })).status).toBe(400);
    expect((await post('listen', { link })).status).toBe(400);
    vi.mocked(volunteer.listen).mockRejectedValueOnce(new VolunteerError('link_invalid', 'closed'));
    expect((await post('listen', { link, clipId })).status).toBe(404);
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

  it('slows a visitor who sends far too many requests, without affecting others', async () => {
    const seen: string[] = [];
    const { app } = volunteerApp({ allow: (key) => { seen.push(key); return key !== '198.51.100.9'; } });
    const send = (ip: string) => app.request('/v1/volunteer/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ link }),
    });
    const blocked = await send('198.51.100.9, 10.0.0.1');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });
    expect((await send('203.0.113.7')).status).toBe(200);
    expect(seen).toEqual(['198.51.100.9', '203.0.113.7']);
  });

  it('answers 429 when too many volunteers are joining', async () => {
    const { post, volunteer } = volunteerApp();
    vi.mocked(volunteer.join).mockRejectedValueOnce(new VolunteerError('too_many_joins', 'busy'));
    expect((await post('join', { link, pseudonym: 'Neema' })).status).toBe(429);
  });
});
