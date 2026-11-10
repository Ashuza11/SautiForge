import { useCallback, useEffect, useRef, useState } from 'react';

import type { Project } from '../../../src/features/projects/domain/project';
import type { Source } from '../../../server/src/sources/source';
import { ApiClient, ApiError, type ApiBatch, type ApiClip } from '../api/client';
import { availableClips, batchLink, defaultSelection, MAX_BATCH_SIZE, newestFirst, shareMessage } from '../domain/batches-view';
import { formatSeconds } from '../domain/clips-view';

type Props = { client: ApiClient; project: Project; source: Source; onSignedOut: () => void; onGoUpload: () => void };

export function BatchesPage({ client, project, source, onSignedOut, onGoUpload }: Props) {
  const [clips, setClips] = useState<ApiClip[] | null>(null);
  const [batches, setBatches] = useState<ApiBatch[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const touched = useRef(false);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) { onSignedOut(); return; }
    setError(cause instanceof Error ? cause.message : 'Something went wrong.');
  }, [onSignedOut]);

  const load = useCallback(async () => {
    try {
      const [loadedClips, loadedBatches] = await Promise.all([client.clips(source.id), client.batches(source.id)]);
      setClips(loadedClips);
      setBatches(loadedBatches);
      const free = availableClips(loadedClips, loadedBatches);
      // Keep the admin's own choices; otherwise start with the next five.
      setSelected((current) => (touched.current ? current.filter((id) => free.some((item) => item.clip.id === id)) : defaultSelection(free)));
    } catch (cause) { fail(cause); }
  }, [client, source.id, fail]);
  useEffect(() => { void load(); }, [load]);

  const free = clips ? availableClips(clips, batches) : [];

  const toggle = (id: string) => {
    touched.current = true;
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : current.length >= MAX_BATCH_SIZE ? current : [...current, id]));
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await client.createBatch(source.id, free.filter((item) => selected.includes(item.clip.id)).map((item) => item.clip.id));
      touched.current = false;
      setOpenId(made.batch.id);
      await load();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const close = async (item: ApiBatch) => {
    if (!window.confirm(`Close "${item.batch.title}"? Its link will stop working and its clips can go in a new batch.`)) return;
    try { await client.closeBatch(item.batch.id); await load(); } catch (cause) { fail(cause); }
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

  const keyOf = (id: string) => clips?.find((item) => item.clip.id === id)?.clip.clipKey ?? '';
  const ordered = newestFirst(batches);

  return (
    <section className="ad-page" aria-labelledby="batches-title">
      <h1 id="batches-title">Batches</h1>
      <p className="ad-muted">A batch is a few clips you share with the community through one link.</p>
      <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} />
      {error ? <p className="ad-error" role="alert">{error}</p> : null}

      <h2>Make a new batch</h2>
      {clips === null ? <p className="ad-muted">Loading…</p> : free.length === 0 ? (
        <div className="ad-empty">
          <p>{clips.length === 0 ? 'You have no clips yet.' : 'All your clips are already in a batch.'}</p>
          <button className="secondary" onClick={onGoUpload}>Upload clips</button>
        </div>
      ) : (
        <>
          <p className="ad-muted">The first five are chosen for you. Tap to change. Up to {MAX_BATCH_SIZE}.</p>
          <ul className="ad-pick">
            {free.map((item) => {
              const on = selected.includes(item.clip.id);
              return (
                <li key={item.clip.id} className={`ad-pick-row${on ? ' ad-pick-on' : ''}`}>
                  <label className="ad-pick-label">
                    <input type="checkbox" checked={on} onChange={() => toggle(item.clip.id)} disabled={!on && selected.length >= MAX_BATCH_SIZE} />
                    <span className="ad-clip-name">{item.clip.clipKey}<small>{formatSeconds(item.clip.durationMs)}</small></span>
                  </label>
                  <button className="ad-play ad-play-small" aria-label={`${playing === item.clip.id ? 'Pause' : 'Play'} ${item.clip.clipKey}`} aria-pressed={playing === item.clip.id} onClick={() => void play(item)}>
                    {playing === item.clip.id ? '❚❚' : '▶'}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="ad-sticky-action">
            <button disabled={busy || selected.length === 0} onClick={() => void create()}>
              {busy ? 'Creating…' : selected.length === 0 ? 'Choose at least one clip' : `Create batch of ${selected.length}`}
            </button>
          </div>
        </>
      )}

      <h2>Shared batches</h2>
      {ordered.length === 0 ? <p className="ad-empty">No batch yet. Your first one will appear here with its link.</p> : (
        <ul className="ad-batches">
          {ordered.map((item) => (
            <BatchCard
              key={item.batch.id}
              item={item}
              open={openId === item.batch.id}
              language={project.languageVariety || project.targetLanguage}
              keys={item.clipIds.map(keyOf).filter(Boolean)}
              onToggle={() => setOpenId(openId === item.batch.id ? null : item.batch.id)}
              onClose={() => void close(item)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function BatchCard({ item, open, language, keys, onToggle, onClose }: {
  item: ApiBatch;
  open: boolean;
  language: string;
  keys: string[];
  onToggle: () => void;
  onClose: () => void;
}) {
  const link = batchLink(window.location.origin, item);
  const [message, setMessage] = useState(() => shareMessage({ language, count: item.clipIds.length, link }));
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);

  const copy = async (what: 'link' | 'message', text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); window.setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); }
  };
  const isOpen = item.batch.status === 'open';

  return (
    <li className={`ad-batch${isOpen ? '' : ' ad-batch-closed'}`}>
      <button className="ad-batch-head" aria-expanded={open} onClick={onToggle}>
        <span className="ad-clip-name">{item.batch.title}<small>{item.clipIds.length} {item.clipIds.length === 1 ? 'clip' : 'clips'}{keys.length ? ` · ${keys.join(', ')}` : ''}</small></span>
        <span className={`ad-pill ${isOpen ? '' : 'ad-pill-grey'}`}>{isOpen ? 'Open' : 'Closed'}</span>
      </button>
      {open ? (
        <div className="ad-batch-body">
          {isOpen ? (
            <>
              <label className="ad-field">
                <span>Message to send</span>
                <textarea rows={10} value={message} onChange={(event) => setMessage(event.target.value)} />
              </label>
              <div className="ad-actions">
                <button onClick={() => void copy('message', message)}>{copied === 'message' ? 'Copied ✓' : 'Copy message'}</button>
                <button className="secondary" onClick={() => void copy('link', link)}>{copied === 'link' ? 'Copied ✓' : 'Copy link only'}</button>
              </div>
              <p className="ad-hint">Paste it into your WhatsApp group. Anyone with the link can help, with no account.</p>
              <button className="quiet ad-small" onClick={onClose}>Close this batch</button>
            </>
          ) : <p className="ad-muted">This batch is closed. Its link no longer works.</p>}
        </div>
      ) : null}
    </li>
  );
}
