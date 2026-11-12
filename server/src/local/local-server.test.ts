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

  it('lets volunteers answer a batch with no account, two people per clip, and never edits an answer', async () => {
    const upload = async (key: string, extra: number) => {
      const response = await server.app.request(`${base}/v1/admin/sources/${sourceId}/clips/upload?clipKey=${key}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/flac' }, body: new Uint8Array(fakeFlac(24000, 48_000, 1, 16, 300 + extra)),
      });
      return ((await response.json()) as { clip: { id: string } }).clip.id;
    };
    const [a, b] = [await upload('v001', 1), await upload('v002', 2)];
    const batch = await (await api(`/v1/admin/sources/${sourceId}/batches`, 'POST', { clipIds: [a, b] })).json() as { batch: { id: string }; token: string };
    const link = `${batch.batch.id}.${batch.token}`;
    const call = (path: string, body: unknown) => server.app.request(`${base}/v1/volunteer/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const join = async (name: string) => ((await (await call('join', { link, pseudonym: name })).json()) as { token: string }).token;
    type Next = { clip: { clipId: string; audioUrl: string; position: number } | null; progress: { total: number; answered: number } };
    const next = async (contributor: string) => (await (await call('next', { link, contributor })).json()) as Next;

    expect(await (await call('info', { link })).json()).toMatchObject({ clipCount: 2 });
    const [one, two, three] = [await join('Neema'), await join('Baraka'), await join('Cirhuza')];

    const offered = await next(one);
    expect(offered.clip?.clipId).toBe(a);
    expect(offered.progress).toEqual({ total: 2, answered: 0 });
    expect((await next(three)).progress).toEqual({ total: 2, answered: 0 });
    const heard = await server.app.request(offered.clip!.audioUrl);
    expect(heard.headers.get('content-type')).toBe('audio/flac');
    expect(JSON.stringify(offered)).not.toContain('transcript');

    const send = (contributor: string, clipId: string, text: string, correction?: string) => call('submit', { link, contributor, clipId, text, correction });
    expect((await send(one, a, 'first words')).status).toBe(200);
    expect((await send(one, a, 'changed my mind')).status).toBe(200); // a retry is harmless, never an edit
    expect((await next(two)).clip?.clipId).toBe(a); // still needs a second, independent person
    expect((await send(two, a, 'second words', ' second   words fixed ')).status).toBe(200);
    expect((await next(three)).clip?.clipId).toBe(b); // clip a already has its two transcripts
    expect((await call('skip', { link, contributor: three, clipId: b })).status).toBe(200);
    expect(await next(three)).toEqual({ clip: null, progress: { total: 1, answered: 1 } });

    const rows = (await server.database.query('SELECT transcript_text, kind FROM submissions ORDER BY created_at, id')).rows as { transcript_text: string | null; kind: string }[];
    expect(rows.filter((row) => row.kind === 'transcript').map((row) => row.transcript_text).sort()).toEqual(['first words', 'second words']);
    expect(rows.filter((row) => row.kind === 'skip')).toHaveLength(1);

    // the admin sees every answer, grouped by batch and clip, with the nicknames
    const results = await (await api(`/v1/admin/sources/${sourceId}/results`)).json() as {
      required: number; volunteers: number;
      batches: { batch: { id: string }; volunteers: number; clips: { clipId: string; clipKey: string; position: number; skips: number; transcripts: { pseudonym: string; text: string; correction: string | null }[] }[] }[];
    };
    expect(results.required).toBe(2);
    const mine = results.batches.find((item) => item.batch.id === batch.batch.id)!;
    expect(mine.volunteers).toBe(3);
    expect(mine.clips.map((item) => item.clipKey)).toEqual(['v001', 'v002']);
    expect(mine.clips[0]?.transcripts.map((item) => `${item.pseudonym}: ${item.text}`).sort()).toEqual(['Baraka: second words', 'Neema: first words']);
    expect(mine.clips[1]).toMatchObject({ skips: 1, transcripts: [] });
    // what was heard and the suggested correct form are kept apart
    expect(mine.clips[0]?.transcripts.map((item) => `${item.text} | ${item.correction}`).sort()).toEqual(['first words | null', 'second words | second words fixed']);
    expect((await server.app.request(`${base}/v1/admin/sources/${sourceId}/results`)).status).toBe(401);

    // the database itself refuses to change or remove an answer
    await expect(server.database.query("UPDATE submissions SET transcript_text = 'tampered'")).rejects.toThrow('append-only');
    await expect(server.database.query('DELETE FROM submissions')).rejects.toThrow('append-only');
    const after = (await server.database.query('SELECT transcript_text FROM submissions WHERE kind = $1', ['transcript'])).rows as { transcript_text: string }[];
    expect(after.map((row) => row.transcript_text).sort()).toEqual(['first words', 'second words']);

    // wrong code, and a closed batch, both stop working
    expect((await call('next', { link: `${batch.batch.id}.${'z'.repeat(24)}`, contributor: one })).status).toBe(404);
    expect((await call('next', { link, contributor: `${one.split('.')[0]}.${'z'.repeat(24)}` })).status).toBe(401);
    await api(`/v1/admin/batches/${batch.batch.id}/close`, 'POST');
    expect((await call('next', { link, contributor: one })).status).toBe(404);
    expect((await send(two, b, 'too late')).status).toBe(404);
  });

  it('records versioned final transcripts and exports only approved clips with checkable audio', async () => {
    const flacFor = (extra: number) => Buffer.from(fakeFlac(24000, 72_000, 1, 16, 400 + extra));
    const upload = async (key: string, bytes: Buffer) => {
      const response = await server.app.request(`${base}/v1/admin/sources/${sourceId}/clips/upload?clipKey=${key}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/flac' }, body: new Uint8Array(bytes),
      });
      return ((await response.json()) as { clip: { id: string } }).clip.id;
    };
    const files = [flacFor(1), flacFor(2), flacFor(3)];
    const [a, b, c] = [await upload('f001', files[0]!), await upload('f002', files[1]!), await upload('f010', files[2]!)];
    const batch = await (await api(`/v1/admin/sources/${sourceId}/batches`, 'POST', { clipIds: [a, b, c] })).json() as { batch: { id: string }; token: string };
    const link = `${batch.batch.id}.${batch.token}`;
    const call = (path: string, body: unknown) => server.app.request(`${base}/v1/volunteer/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const contributor = ((await (await call('join', { link, pseudonym: 'Neema' })).json()) as { token: string }).token;
    const first = await (await call('next', { link, contributor })).json() as { clip: { clipId: string } };
    await call('submit', { link, contributor, clipId: first.clip.clipId, text: 'volunteer words' });
    const submissionId = ((await server.database.query('SELECT id FROM submissions WHERE clip_id = $1', [first.clip.clipId])).rows[0] as { id: string }).id;

    const finalize = (clipId: string, body: unknown) => api(`/v1/admin/clips/${clipId}/final`, 'POST', body);
    // approve by choosing a volunteer's answer, then correct it: two versions, the first is kept
    const v1 = await finalize(first.clip.clipId, { decision: 'approved', text: 'volunteer words', chosenSubmissionId: submissionId });
    expect(v1.status).toBe(201);
    expect(((await v1.json()) as { final: { version: number } }).final.version).toBe(1);
    const v2 = await (await finalize(first.clip.clipId, { decision: 'approved', text: 'corrected words', note: 'Elder corrected it' })).json() as { final: { version: number } };
    expect(v2.final.version).toBe(2);
    const history = await (await api(`/v1/admin/clips/${first.clip.clipId}/final`)).json() as { history: { version: number; text: string }[] };
    expect(history.history.map((row) => [row.version, row.text])).toEqual([[1, 'volunteer words'], [2, 'corrected words']]);

    // a clip outside any batch, an answer from another clip, and an unknown clip are refused
    const lone = await upload('f099', flacFor(9));
    expect((await finalize(lone, { decision: 'approved', text: 'x' })).status).toBe(409);
    const other = [a, b, c].find((id) => id !== first.clip.clipId)!;
    expect((await finalize(other, { decision: 'approved', text: 'x', chosenSubmissionId: submissionId })).status).toBe(409);
    expect((await finalize('00000000-0000-4000-8000-0000000fffff', { decision: 'excluded' })).status).toBe(404);

    // exclude one clip, approve another
    expect((await finalize(other, { decision: 'excluded', note: 'Too noisy' })).status).toBe(201);
    const third = [a, b, c].find((id) => id !== first.clip.clipId && id !== other)!;
    expect((await finalize(third, { decision: 'approved', text: 'third words' })).status).toBe(201);

    // the database refuses to rewrite a decision
    await expect(server.database.query("UPDATE final_transcripts SET transcript_text = 'tampered'")).rejects.toThrow('append-only');
    await expect(server.database.query('DELETE FROM final_transcripts')).rejects.toThrow('append-only');

    // results show the newest decision
    const results = await (await api(`/v1/admin/sources/${sourceId}/results`)).json() as { batches: { clips: { clipId: string; final: { version: number; text: string | null; decision: string } | null }[] }[] };
    const shown = results.batches.flatMap((item) => item.clips).find((item) => item.clipId === first.clip.clipId);
    expect(shown?.final).toMatchObject({ version: 2, decision: 'approved', text: 'corrected words' });

    // export: only approved clips, with the exact audio behind each link
    const manifest = await (await api(`/v1/admin/sources/${sourceId}/export`)).json() as {
      totals: { approved: number; excluded: number; durationMs: number };
      rights: { decision: string } | null;
      clips: { clipId: string; clipKey: string; transcript: string; finalVersion: number; durationMs: number; flac: { url: string; sha256: string; sizeBytes: number } }[];
    };
    expect(manifest.totals).toMatchObject({ approved: 2, excluded: 1 });
    expect(manifest.totals.durationMs).toBe(6000);
    expect(manifest.rights?.decision).toBe('approved');
    expect(manifest.clips.map((item) => [item.clipKey, item.transcript, item.finalVersion]).sort()).toEqual(
      [[manifest.clips.find((item) => item.clipId === first.clip.clipId)!.clipKey, 'corrected words', 2], [manifest.clips.find((item) => item.clipId === third)!.clipKey, 'third words', 1]].sort(),
    );
    for (const item of manifest.clips) {
      const bytes = Buffer.from(await (await server.app.request(item.flac.url)).arrayBuffer());
      expect(bytes.length).toBe(item.flac.sizeBytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.flac.sha256);
    }
    expect((await server.app.request(`${base}/v1/admin/sources/${sourceId}/export`)).status).toBe(401);
  });
});
