import { describe, expect, it, vi } from 'vitest';

import { VolunteerApiError, VolunteerClient } from './volunteer-client';

const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const link = 'id.code';

describe('VolunteerClient', () => {
  it('sends the link and personal token in the body, with no cookies', async () => {
    const fetcher = reply(200, { clip: null, progress: { total: 5, answered: 5 } });
    await new VolunteerClient(link, '', fetcher).next('tok');
    expect(fetcher).toHaveBeenCalledWith('/v1/volunteer/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link, contributor: 'tok' }) });
  });

  it('submits and skips by clip', async () => {
    const fetcher = reply(200, { status: 'recorded' });
    const client = new VolunteerClient(link, 'https://api.example.org', fetcher);
    await client.submit('tok', 'clip', 'mwana');
    expect(fetcher).toHaveBeenLastCalledWith('https://api.example.org/v1/volunteer/submit', expect.objectContaining({ body: JSON.stringify({ link, contributor: 'tok', clipId: 'clip', text: 'mwana' }) }));
    await client.skip('tok', 'clip');
    expect(fetcher).toHaveBeenLastCalledWith('https://api.example.org/v1/volunteer/skip', expect.anything());
  });

  it('explains problems in plain words a volunteer can act on', async () => {
    await expect(new VolunteerClient(link, '', reply(404, { error: 'link_invalid' })).info()).rejects.toMatchObject({ status: 404, code: 'link_invalid', message: expect.stringContaining('closed') });
    await expect(new VolunteerClient(link, '', reply(401, { error: 'contributor_invalid' })).next('t')).rejects.toMatchObject({ status: 401, message: expect.stringContaining('nickname') });
    await expect(new VolunteerClient(link, '', reply(500, {})).next('t')).rejects.toBeInstanceOf(VolunteerApiError);
    const offline = new VolunteerClient(link, '', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(offline.submit('t', 'c', 'x')).rejects.toMatchObject({ status: 0, code: 'network', message: expect.stringContaining('saved') });
  });
});
