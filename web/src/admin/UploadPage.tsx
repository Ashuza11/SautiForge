import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

import type { Project } from '../../../src/features/projects/domain/project';
import type { Source } from '../../../server/src/sources/source';
import { ApiClient, ApiError, type ApiClip } from '../api/client';
import { formatSeconds, formatTotal } from '../domain/clips-view';
import { formatSize, planUploads } from '../domain/upload';

type Item = {
  id: number;
  name: string;
  size: number;
  clipKey: string | null;
  state: 'waiting' | 'sending' | 'done' | 'failed' | 'refused';
  note: string;
};

type Props = { client: ApiClient; project: Project; source: Source; onSignedOut: () => void };

let nextId = 1;

export function UploadPage({ client, source, onSignedOut }: Props) {
  const [clips, setClips] = useState<ApiClip[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) { onSignedOut(); return; }
    setError(cause instanceof Error ? cause.message : 'Something went wrong.');
  }, [onSignedOut]);

  const reload = useCallback(async () => {
    try { setClips(await client.clips(source.id)); } catch (cause) { fail(cause); }
  }, [client, source.id, fail]);
  useEffect(() => { void reload(); }, [reload]);

  const patch = (id: number, change: Partial<Item>) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));

  const send = async (item: Item, file: File) => {
    if (item.clipKey === null) return;
    patch(item.id, { state: 'sending', note: '' });
    try {
      await client.uploadClip(source.id, item.clipKey, file);
      patch(item.id, { state: 'done', note: 'Added' });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { onSignedOut(); return; }
      patch(item.id, { state: 'failed', note: cause instanceof Error ? cause.message : 'Upload failed.' });
    }
  };

  const add = async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (files.length === 0) return;
    setError(null);
    const plans = planUploads(files);
    const fresh: Item[] = plans.map((plan) => ({
      id: nextId++,
      name: plan.file.name,
      size: plan.file.size,
      clipKey: plan.clipKey,
      state: plan.clipKey === null ? 'refused' : 'waiting',
      note: plan.clipKey === null ? plan.problem : '',
    }));
    setItems((current) => [...fresh, ...current]);
    // Two at a time keeps a phone connection steady.
    const queue = fresh.map((item, index) => ({ item, file: plans[index].file })).filter(({ item }) => item.clipKey !== null);
    const workers = [0, 1].map(async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await send(next.item, next.file);
    });
    await Promise.all(workers);
    await reload();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void add(event.dataTransfer.files);
  };

  const play = async (clip: ApiClip) => {
    const element = audio.current;
    if (!element) return;
    if (playing === clip.clip.id && !element.paused) { element.pause(); setPlaying(null); return; }
    try {
      element.src = await client.audioUrl(clip.clip.id, 'listening');
      await element.play();
      setPlaying(clip.clip.id);
    } catch (cause) {
      setPlaying(null);
      if (cause instanceof ApiError) fail(cause); else setError('This clip could not be played.');
    }
  };

  const remove = async (clip: ApiClip) => {
    if (!window.confirm(`Remove ${clip.clip.clipKey}? Volunteers will no longer see it.`)) return;
    try { await client.withdraw(clip.clip.id); await reload(); } catch (cause) { fail(cause); }
  };

  const published = (clips ?? []).filter((item) => item.clip.status === 'published');
  const speech = published.reduce((sum, item) => sum + item.clip.durationMs, 0);
  const working = items.some((item) => item.state === 'waiting' || item.state === 'sending');
  const doneCount = items.filter((item) => item.state === 'done').length;
  // While sending, every row is shown; afterwards only what needs attention stays.
  const visibleItems = working ? items : items.filter((item) => item.state !== 'done');

  return (
    <section className="ad-page" aria-labelledby="upload-title">
      <h1 id="upload-title">Upload audio</h1>
      <p className="ad-muted">Choose the .flac files made by the pack command. Each file is one clip.</p>

      <label
        className={`ad-drop${dragging ? ' ad-drop-active' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input ref={input} type="file" accept=".flac,audio/flac" multiple onChange={(event) => { void add(event.target.files ?? []); event.target.value = ''; }} />
        <span className="ad-drop-icon" aria-hidden="true">↑</span>
        <strong>Drop FLAC files here</strong>
        <span className="ad-muted">or tap to choose them</span>
      </label>

      <details className="ad-help">
        <summary>How do I make the files?</summary>
        <p>On your computer, after cutting your clips:</p>
        <pre>python -m sautiseg pack --export segmentation-output/&lt;name&gt;/export --first 10</pre>
        <p>This makes an <code>upload</code> folder next to <code>export</code>. Select the files in it.</p>
      </details>

      {error ? <p className="ad-error" role="alert">{error}</p> : null}

      {items.length > 0 ? (
        <div aria-live="polite">
          {doneCount > 0 && !working ? (
            <p className="ad-success" role="status">
              {doneCount} {doneCount === 1 ? 'file' : 'files'} added.
              <button className="quiet ad-small" onClick={() => setItems((current) => current.filter((item) => item.state !== 'done'))}>Hide</button>
            </p>
          ) : null}
          {visibleItems.length > 0 ? (
            <ul className="ad-queue" aria-label="Uploads">
              {visibleItems.map((item) => (
                <li key={item.id} className={`ad-queue-row ad-${item.state}`}>
                  <span className="ad-queue-name">{item.name}<small>{formatSize(item.size)}</small></span>
                  <span className="ad-queue-state">{labels[item.state]}{item.note && item.state !== 'done' ? <small>{item.note}</small> : null}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {working ? <p className="ad-muted">Uploading… keep this page open.</p> : null}

      <h2>Your clips</h2>
      <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} />
      {clips === null ? <p className="ad-muted">Loading…</p> : published.length === 0 ? (
        <p className="ad-empty">No clips yet. Upload your first files above.</p>
      ) : (
        <>
          <p className="ad-summary"><strong>{published.length}</strong> {published.length === 1 ? 'clip' : 'clips'} · {formatTotal(speech)} of speech</p>
          <ul className="ad-clips">
            {published.map((item) => (
              <li key={item.clip.id} className="ad-clip">
                <button className="ad-play" aria-label={`${playing === item.clip.id ? 'Pause' : 'Play'} ${item.clip.clipKey}`} aria-pressed={playing === item.clip.id} onClick={() => void play(item)}>
                  {playing === item.clip.id ? '❚❚' : '▶'}
                </button>
                <span className="ad-clip-name">{item.clip.clipKey}<small>{formatSeconds(item.clip.durationMs)}</small></span>
                <button className="quiet ad-small" onClick={() => void remove(item)}>Remove</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const labels: Record<Item['state'], string> = {
  waiting: 'Waiting',
  sending: 'Sending…',
  done: 'Added ✓',
  failed: 'Not added',
  refused: 'Skipped',
};
