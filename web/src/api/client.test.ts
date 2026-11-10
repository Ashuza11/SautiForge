import { describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError } from './client';

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('ApiClient', () => {
  it('always sends the session cookie and JSON bodies', async () => {
    const fetcher = respond(200, { status: 'signed_in' });
    await new ApiClient('', fetcher).login('secret passphrase');
    expect(fetcher).toHaveBeenCalledWith('/v1/auth/login', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ password: 'secret passphrase' }),
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('reports whether a session exists without throwing on 401', async () => {
    expect(await new ApiClient('', respond(401, { error: 'unauthorized' })).isSignedIn()).toBe(false);
    expect(await new ApiClient('', respond(200, { status: 'signed_in' })).isSignedIn()).toBe(true);
    await expect(new ApiClient('', respond(500, {})).isSignedIn()).rejects.toBeInstanceOf(ApiError);
  });

  it('turns service errors into plain messages', async () => {
    await expect(new ApiClient('', respond(401, { error: 'invalid_credentials' })).login('x'))
      .rejects.toMatchObject({ status: 401, message: 'Wrong password.' });
    await expect(new ApiClient('', respond(429, { error: 'too_many_attempts' })).login('x'))
      .rejects.toMatchObject({ message: expect.stringContaining('Wait a minute') });
    await expect(new ApiClient('', respond(503, { error: 'server_not_configured' })).projects())
      .rejects.toMatchObject({ message: 'The service is not configured yet.' });
  });

  it('explains an unreachable service', async () => {
    const client = new ApiClient('', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(client.projects()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('makes relative audio links absolute against the service base', async () => {
    const client = new ApiClient('https://api.example.org', respond(200, { url: '/local-storage/a?x=1' }));
    expect(await client.audioUrl('id', 'listening')).toBe('https://api.example.org/local-storage/a?x=1');
    const signed = new ApiClient('', respond(200, { url: 'https://bucket.s3.amazonaws.com/a' }));
    expect(await signed.audioUrl('id', 'master')).toBe('https://bucket.s3.amazonaws.com/a');
  });

  it('creates, updates and archives projects on the service', async () => {
    const draft = {
      title: 'Mashi', description: '', targetLanguage: 'Shi', languageCode: 'shr', languageVariety: 'Mashi', researchDomain: 'Speech',
      collectionLocation: 'South Kivu', protocolVersion: '0.1', annotationProfile: 'verbatim_transcription', status: 'active',
    } as const;
    const fetcher = respond(201, { project: { id: 'p1', ...draft } });
    const client = new ApiClient('', fetcher);
    expect((await client.createProject(draft)).id).toBe('p1');
    expect(fetcher).toHaveBeenLastCalledWith('/v1/admin/projects', expect.objectContaining({ method: 'POST', body: JSON.stringify(draft) }));
    await client.updateProject('p1', draft);
    expect(fetcher).toHaveBeenLastCalledWith('/v1/admin/projects/p1', expect.objectContaining({ method: 'PUT' }));
    await client.archiveProject('p1');
    expect(fetcher).toHaveBeenLastCalledWith('/v1/admin/projects/p1/archive', expect.objectContaining({ method: 'POST' }));
  });

  it('uploads a clip as a raw FLAC named by the file and explains refusals', async () => {
    const fetcher = respond(200, { clip: { id: 'c', status: 'published' }, files: [] });
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    await new ApiClient('', fetcher).uploadClip('s1', 'c 001', blob);
    expect(fetcher).toHaveBeenCalledWith('/v1/admin/sources/s1/clips/upload?clipKey=c%20001', expect.objectContaining({
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'audio/flac' }, body: blob,
    }));
    await expect(new ApiClient('', respond(422, { error: 'unsupported_audio', message: 'This is not a FLAC file.' })).uploadClip('s', 'k', blob))
      .rejects.toMatchObject({ status: 422, message: 'This is not a FLAC file.' });
    await expect(new ApiClient('', respond(413, { error: 'file_too_large' })).uploadClip('s', 'k', blob))
      .rejects.toMatchObject({ message: 'The file is larger than 4 MB.' });
  });
});
