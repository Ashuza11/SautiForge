import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AdminGate } from './AdminGate';
import { ApiClient, ApiError, type ApiClip, type ApiProject, type ApiSource, type ClipVariant } from './api/client';
import { filterClips, formatClock, formatSeconds, formatTotal, isMusicRemoved, speakerLabel, summarizeClips, type StatusFilter } from './domain/clips-view';

const filters: { value: StatusFilter; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Not finished' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'all', label: 'All' },
];

export function ClipsAdmin() {
  return <AdminGate purpose="manage clips">{({ client, onSignedOut }) => <ClipsList client={client} onSignedOut={onSignedOut} />}</AdminGate>;
}

function ClipsList({ client, onSignedOut }: { client: ApiClient; onSignedOut: () => void }) {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [sources, setSources] = useState<ApiSource[]>([]);
  const [projectId, setProjectId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [clips, setClips] = useState<ApiClip[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('published');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ clipId: string; variant: ClipVariant } | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) { onSignedOut(); return; }
    setError(cause instanceof Error ? cause.message : 'Something went wrong.');
  }, [onSignedOut]);

  useEffect(() => {
    client.projects().then((list) => {
      setProjects(list);
      setProjectId((current) => current || list.find((project) => project.languageCode === 'shr')?.id || list[0]?.id || '');
      if (list.length === 0) setLoading(false);
    }, fail);
  }, [client, fail]);

  useEffect(() => {
    if (!projectId) return;
    client.sources(projectId).then((list) => {
      setSources(list);
      setSourceId((current) => (list.some((source) => source.id === current) ? current : list[0]?.id ?? ''));
      if (list.length === 0) { setClips([]); setLoading(false); }
    }, fail);
  }, [client, projectId, fail]);

  const reload = useCallback(async () => {
    if (!sourceId) return;
    setLoading(true);
    try { setClips(await client.clips(sourceId)); setError(null); } catch (cause) { fail(cause); } finally { setLoading(false); }
  }, [client, sourceId, fail]);
  useEffect(() => { void reload(); }, [reload]);

  const play = async (clip: ApiClip, variant: ClipVariant) => {
    const element = audio.current;
    if (!element) return;
    if (playing?.clipId === clip.clip.id && playing.variant === variant && !element.paused) {
      element.pause();
      setPlaying(null);
      return;
    }
    try {
      element.src = await client.audioUrl(clip.clip.id, variant);
      await element.play();
      setPlaying({ clipId: clip.clip.id, variant });
      setError(null);
    } catch (cause) {
      setPlaying(null);
      if (cause instanceof ApiError) fail(cause); else setError('This clip could not be played.');
    }
  };

  const withdraw = async (clip: ApiClip) => {
    if (!window.confirm(`Withdraw ${clip.clip.clipKey}? It will no longer be offered to volunteers. You cannot publish it again under the same key.`)) return;
    try {
      await client.withdraw(clip.clip.id);
      setNotice(`${clip.clip.clipKey} was withdrawn.`);
      await reload();
    } catch (cause) { fail(cause); }
  };

  const summary = summarizeClips(clips);
  const visible = filterClips(clips, filter);

  return (
    <main className="seg-review">
      <div className="seg-head">
        <div className="seg-title">
          <h2>Clips</h2>
          <p>Published clips are the ones that can be put in a batch for volunteers.</p>
        </div>
        <button className="quiet" onClick={() => void client.logout().then(onSignedOut, fail)}>Sign out</button>
      </div>

      <div className="clips-pickers">
        <label className="clips-field">Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </label>
        <label className="clips-field">Source
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}
          </select>
        </label>
      </div>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="save-message" role="status">{notice}</div> : null}

      {loading ? null : (
        <p className="clips-summary">
          <strong>{summary.published}</strong> published · {formatTotal(summary.publishedMs)} of speech
          {summary.draft ? ` · ${summary.draft} not finished` : ''}{summary.withdrawn ? ` · ${summary.withdrawn} withdrawn` : ''}
        </p>
      )}

      <div className="clips-filters" role="group" aria-label="Show">
        {filters.map((item) => (
          <button key={item.value} className={filter === item.value ? '' : 'secondary'} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>
        ))}
      </div>

      <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} />

      {loading ? <p className="seg-note">Loading clips…</p> : visible.length === 0 ? (
        <p className="seg-note">{clips.length === 0 ? 'No clips yet. Publish an export with the publish command.' : 'No clips match this filter.'}</p>
      ) : (
        <ul className="clips-list">
          {visible.map((item) => {
            const isPlaying = (variant: ClipVariant) => playing?.clipId === item.clip.id && playing.variant === variant;
            const playable = item.clip.status !== 'withdrawn';
            return (
              <li key={item.clip.id} className="clips-row">
                <div className="clips-main">
                  <strong>{item.clip.clipKey}</strong>
                  <span>{formatSeconds(item.clip.durationMs)}</span>
                  <span className="clips-muted">at {formatClock(item.clip.startMs)} in the film</span>
                </div>
                <div className="clips-meta">
                  <span>{speakerLabel(item.clip)}{isMusicRemoved(item) ? ' · music removed' : ''}</span>
                  <span className={`clips-status clips-status-${item.clip.status}`}>{filters.find((f) => f.value === item.clip.status)?.label ?? item.clip.status}</span>
                </div>
                <div className="clips-actions">
                  <button className="secondary" disabled={!playable} aria-pressed={isPlaying('listening')} onClick={() => void play(item, 'listening')}>
                    {isPlaying('listening') ? 'Pause' : 'Play'}
                  </button>
                  {item.clip.status !== 'withdrawn' ? <button className="quiet" onClick={() => void withdraw(item)}>Withdraw</button> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
