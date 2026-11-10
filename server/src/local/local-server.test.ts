import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fakeFlac } from '../clips/flac.test';
import { createLocalServer, type LocalServer } from './local-server';
import { seedLocalData } from './seed';

const token = 'local-test-admin-token-with-32-chars-x';
const origin = 'http://127.0.0.1:4173';
const base = 'http://127.0.0.1:8787';

let directory: string;
let server: LocalServer;
let sourceId: string;

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'sautiforge-local-'));
  server = await createLocalServer({
    dataDirectory: directory,
    webOrigin: origin,
    publicBaseUrl: base,
    adminApiToken: token,
    adminPassword: 'a long admin passphrase',
    sessionSecret: 's'.repeat(32),
  });
  sourceId = (await seedLocalData(server)).sourceId;
}, 60_000);

afterAll(async () => {
  await server.database.close();
  await rm(directory, { recursive: true, force: true });
});

const wav = (seed: number) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(200, seed)]);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const api = (path: string, method = 'GET', body?: unknown) => server.app.request(`${base}${path}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

function draft(key: string, master: Buffer, listening: Buffer) {
  const audio = (variant: string, bytes: Buffer) => ({
    variant, derivedFrom: 'cleaned', sizeBytes: bytes.length, sha256: sha(bytes),
    pcmSha256: variant === 'master' ? sha(Buffer.from(`wav-${key}`)) : null, sampleRate: 48000, durationMs: 3000,
  });
  return {
    clipKey: key, startMs: 0, endMs: 3000, trimmedMs: 0, durationMs: 3000, speakerRole: 'narrator',
    speakerName: 'Voice A', hasMusic: false, tier: 'asr_tts', segmenter: null, createdBy: 'ADMIN-01',
    audio: [audio('master', master), audio('listening', listening)],
  };
}

async function put(upload: { url: string; headers: Record<string, string> }, bytes: Buffer) {
  return server.app.request(upload.url, { method: 'PUT', headers: upload.headers, body: new Uint8Array(bytes) });
}

describe('local mode (real SQL on PGlite, audio on disk)', () => {
  it('seeds an approved Mashi source once', async () => {
    expect((await seedLocalData(server)).created).toBe(false);
  });

  it('publishes a clip end to end and serves the exact bytes back', async () => {
    const master = wav(1);
    const listening = wav(2);
    const registered = await (await api(`/v1/admin/sources/${sourceId}/clips`, 'POST', draft('c001', master, listening))).json() as {
      clip: { id: string };
      files: { file: { variant: string }; upload: { url: string; headers: Record<string, string> } }[];
    };
    for (const item of registered.files) {
      const bytes = item.file.variant === 'master' ? master : listening;
      expect((await put(item.upload, bytes)).status).toBe(200);
    }
    const done = await (await api(`/v1/admin/clips/${registered.clip.id}/complete`, 'POST')).json() as { clip: { status: string } };
    expect(done.clip.status).toBe('published');

    const { url } = await (await api(`/v1/admin/clips/${registered.clip.id}/audio/listening`)).json() as { url: string };
    const played = await server.app.request(url);
    expect(played.headers.get('content-type')).toBe('audio/ogg');
    expect(Buffer.from(await played.arrayBuffer()).equals(listening)).toBe(true);
    expect((await server.app.request(`${url}x`)).status).toBe(403);

    const again = await (await api(`/v1/admin/sources/${sourceId}/clips`, 'POST', draft('c001', master, listening))).json() as { files: { upload: unknown }[] };
    expect(again.files.every((file) => file.upload === null)).toBe(true);
  });

  it('refuses wrong bytes, then refuses to publish without the upload', async () => {
    const good = wav(3);
    const registered = await (await api(`/v1/admin/sources/${sourceId}/clips`, 'POST', draft('c002', good, good)))
      .json() as { clip: { id: string }; files: { upload: { url: string; headers: Record<string, string> } }[] };
    const response = await put(registered.files[0].upload, wav(9));
    expect(response.status).toBe(400);
    const complete = await api(`/v1/admin/clips/${registered.clip.id}/complete`, 'POST');
    expect(complete.status).toBe(409);
    const list = await (await api(`/v1/admin/sources/${sourceId}/clips?status=published`)).json() as { clips: unknown[] };
    expect(list.clips).toHaveLength(1);
  });

  it('withdraws a clip so it leaves the published list', async () => {
    const list = await (await api(`/v1/admin/sources/${sourceId}/clips?status=published`)).json() as { clips: { clip: { id: string } }[] };
    const id = list.clips[0].clip.id;
    const withdrawn = await (await api(`/v1/admin/clips/${id}/withdraw`, 'POST')).json() as { clip: { status: string } };
    expect(withdrawn.clip.status).toBe('withdrawn');
    expect(((await (await api(`/v1/admin/sources/${sourceId}/clips?status=published`)).json()) as { clips: unknown[] }).clips).toHaveLength(0);
  });

  it('uploads one FLAC through the API, publishes it, and serves the exact bytes back', async () => {
    const flac = Buffer.from(fakeFlac(24000, 96_000, 1, 16, 500));
    const send = (key: string, bytes: Buffer) => server.app.request(`${base}/v1/admin/sources/${sourceId}/clips/upload?clipKey=${key}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/flac' }, body: new Uint8Array(bytes),
    });
    const first = await send('u001', flac);
    expect(first.status).toBe(200);
    const done = await first.json() as { clip: { id: string; status: string; durationMs: number }; files: { variant: string }[] };
    expect(done.clip).toMatchObject({ status: 'published', durationMs: 4000 });
    expect(done.files.map((file) => file.variant)).toEqual(['master']);

    const { url } = await (await api(`/v1/admin/clips/${done.clip.id}/audio/listening`)).json() as { url: string };
    const played = await server.app.request(url);
    expect(played.headers.get('content-type')).toBe('audio/flac');
    expect(Buffer.from(await played.arrayBuffer()).equals(flac)).toBe(true);

    expect((await send('u001', flac)).status).toBe(200);
    expect((await send('u002', Buffer.from('not audio at all, just text that is long enough to pass the size floor.'))).status).toBe(422);
    expect((await send('u001', Buffer.from(fakeFlac(24000, 96_000, 1, 16, 900)))).status).toBe(409);
  });

  it('shares published clips in batches, never twice at once, with signed links', async () => {
    const upload = async (key: string, extra: number) => {
      const response = await server.app.request(`${base}/v1/admin/sources/${sourceId}/clips/upload?clipKey=${key}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/flac' }, body: new Uint8Array(fakeFlac(24000, 48_000, 1, 16, 200 + extra)),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { clip: { id: string } }).clip.id;
    };
    const [a, b, c, d] = [await upload('b001', 1), await upload('b002', 2), await upload('b003', 3), await upload('b004', 4)];
    const createBatch = (clipIds: string[], title?: string) => api(`/v1/admin/sources/${sourceId}/batches`, 'POST', { clipIds, ...(title ? { title } : {}) });

    const first = await createBatch([a, b, c]);
    expect(first.status).toBe(201);
    const created = await first.json() as { batch: { id: string; title: string; status: string }; clipIds: string[]; token: string };
    expect(created.clipIds).toEqual([a, b, c]);
    expect(created.batch.status).toBe('open');
    expect(created.token).toHaveLength(24);

    // clips already in an open batch, withdrawn clips and unknown clips are refused, and nothing is half-created
    expect((await createBatch([c, d])).status).toBe(409);
    await api(`/v1/admin/clips/${d}/withdraw`, 'POST');
    expect((await createBatch([d])).status).toBe(409);
    expect((await createBatch([a, '00000000-0000-4000-8000-0000000fffff'])).status).toBe(409);
    const listed = await (await api(`/v1/admin/sources/${sourceId}/batches`)).json() as { batches: { batch: { id: string }; clipIds: string[] }[] };
    expect(listed.batches.filter((item) => item.clipIds.includes(c))).toHaveLength(1);

    // closing frees the clips for a new batch
    expect(((await (await api(`/v1/admin/batches/${created.batch.id}/close`, 'POST')).json()) as { batch: { status: string } }).batch.status).toBe('closed');
    const second = await createBatch([a, b], 'Second try');
    expect(second.status).toBe(201);
    expect(((await second.json()) as { batch: { title: string } }).batch.title).toBe('Second try');
  });
});
