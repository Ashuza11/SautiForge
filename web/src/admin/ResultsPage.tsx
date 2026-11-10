import { useCallback, useEffect, useRef, useState } from 'react';

import type { Project } from '../../../src/features/projects/domain/project';
import type { Source } from '../../../server/src/sources/source';
import { ApiClient, ApiError } from '../api/client';
import { formatSeconds } from '../domain/clips-view';
import {
  batchProgress, clipDifferenceBlock, differencesMessage, firstDifference, percent, stateLabel, summarize, versions, clipState,
  type BatchResult, type ClipResult, type SourceResults,
} from '../domain/results-view';
import type { DiffPart } from '../domain/text-diff';

type Props = { client: ApiClient; project: Project; source: Source; onSignedOut: () => void; onGoBatches: () => void };

const REFRESH_MS = 30_000;

export function ResultsPage({ client, source, onSignedOut, onGoBatches }: Props) {
  const [results, setResults] = useState<SourceResults | null>(null);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [openClip, setOpenClip] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const firstLoad = useRef(true);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) { onSignedOut(); return; }
    setError(cause instanceof Error ? cause.message : 'Something went wrong.');
  }, [onSignedOut]);

  const load = useCallback(async () => {
    try {
      const loaded = await client.results(source.id);
      setResults(loaded);
      setUpdated(new Date());
      setError(null);
      if (firstLoad.current) { firstLoad.current = false; setOpenBatch(loaded.batches[0]?.batch.id ?? null); }
    } catch (cause) { fail(cause); }
  }, [client, source.id, fail]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000); } catch { setCopied(null); }
  };

  const play = async (clip: ClipResult) => {
    const element = audio.current;
    if (!element) return;
    if (playing === clip.clipId && !element.paused) { element.pause(); setPlaying(null); return; }
    try {
      element.src = await client.audioUrl(clip.clipId, 'listening');
      await element.play();
      setPlaying(clip.clipId);
    } catch (cause) {
      setPlaying(null);
      if (cause instanceof ApiError) fail(cause); else setError('This clip could not be played.');
    }
  };

  const required = results?.required ?? 2;
  const totals = results ? summarize(results) : null;

  return (
    <section className="ad-page" aria-labelledby="results-title">
      <div className="ad-title-row">
        <h1 id="results-title">Results</h1>
        <button className="secondary ad-small" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="ad-muted">What the community wrote.{updated ? ` Updated ${updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}</p>
      <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} />
      {error ? <p className="ad-error" role="alert">{error}</p> : null}

      {results === null ? <p className="ad-muted">Loading…</p> : results.batches.length === 0 ? (
        <div className="ad-empty">
          <p>No batch has been shared yet.</p>
          <button className="secondary" onClick={onGoBatches}>Make a batch</button>
        </div>
      ) : (
        <>
          {totals ? (
            <dl className="ad-tiles">
              <div><dt>Volunteers</dt><dd>{totals.volunteers}</dd></div>
              <div><dt>Answers</dt><dd>{totals.answers}</dd></div>
              <div><dt>Clips done</dt><dd>{totals.complete}</dd></div>
              <div className={totals.needLook > 0 ? 'ad-tile-alert' : ''}><dt>Need a look</dt><dd>{totals.needLook}</dd></div>
            </dl>
          ) : null}

          <ul className="ad-batches">
            {results.batches.map((item) => (
              <BatchSection
                key={item.batch.id}
                item={item}
                required={required}
                open={openBatch === item.batch.id}
                openClip={openClip}
                playing={playing}
                copied={copied}
                onToggle={() => setOpenBatch(openBatch === item.batch.id ? null : item.batch.id)}
                onOpenClip={(id) => setOpenClip(openClip === id ? null : id)}
                onPlay={(clip) => void play(clip)}
                onCopy={(key, text) => void copy(key, text)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function BatchSection({ item, required, open, openClip, playing, copied, onToggle, onOpenClip, onPlay, onCopy }: {
  item: BatchResult;
  required: number;
  open: boolean;
  openClip: string | null;
  playing: string | null;
  copied: string | null;
  onToggle: () => void;
  onOpenClip: (clipId: string) => void;
  onPlay: (clip: ClipResult) => void;
  onCopy: (key: string, text: string) => void;
}) {
  const progress = batchProgress(item, required);
  const message = differencesMessage(item.clips, required);
  return (
    <li className="ad-batch">
      <button className="ad-batch-head" aria-expanded={open} onClick={onToggle}>
        <span className="ad-clip-name">
          {item.batch.title}
          <small>{progress.complete} of {progress.clips} clips done · {item.volunteers} {item.volunteers === 1 ? 'volunteer' : 'volunteers'}</small>
        </span>
        {progress.differ > 0 ? <span className="ad-pill ad-pill-alert">{progress.differ} differ</span> : <span className={`ad-pill ${item.batch.status === 'open' ? '' : 'ad-pill-grey'}`}>{item.batch.status === 'open' ? 'Open' : 'Closed'}</span>}
      </button>
      <div className="ad-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(progress.answers, progress.needed)} aria-label={`${item.batch.title} progress`}>
        <span style={{ width: `${percent(progress.answers, progress.needed)}%` }} />
      </div>
      {open ? (
        <div className="ad-batch-body">
          <p className="ad-hint">{progress.answers} of {progress.needed} answers received. Each clip needs {required} different people.</p>
          <ul className="ad-results">
            {item.clips.map((clip) => (
              <ClipRow
                key={clip.clipId}
                clip={clip}
                required={required}
                open={openClip === clip.clipId}
                playing={playing === clip.clipId}
                copied={copied}
                onToggle={() => onOpenClip(clip.clipId)}
                onPlay={() => onPlay(clip)}
                onCopy={onCopy}
              />
            ))}
          </ul>
          {message ? (
            <button className="secondary" onClick={() => onCopy(`batch-${item.batch.id}`, message)}>
              {copied === `batch-${item.batch.id}` ? 'Copied ✓' : `Copy all differences for WhatsApp (${progress.differ})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ClipRow({ clip, required, open, playing, copied, onToggle, onPlay, onCopy }: {
  clip: ClipResult;
  required: number;
  open: boolean;
  playing: boolean;
  copied: string | null;
  onToggle: () => void;
  onPlay: () => void;
  onCopy: (key: string, text: string) => void;
}) {
  const state = clipState(clip, required);
  const difference = firstDifference(clip);
  const own = clip.status === 'withdrawn' ? ' · removed' : '';
  return (
    <li className={`ad-result ad-result-${state}`}>
      <div className="ad-result-head">
        <button className="ad-play ad-play-small" aria-label={`${playing ? 'Pause' : 'Play'} ${clip.clipKey}`} aria-pressed={playing} onClick={onPlay}>{playing ? '❚❚' : '▶'}</button>
        <button className="ad-result-main" aria-expanded={open} onClick={onToggle}>
          <span className="ad-clip-name">{clip.clipKey}<small>{formatSeconds(clip.durationMs)}{own}{clip.skips > 0 ? ` · ${clip.skips} skipped` : ''}</small></span>
          <span className={`ad-state ad-state-${state}`}>{stateLabel(clip, required)}</span>
        </button>
      </div>
      {open ? (
        <div className="ad-result-body">
          {clip.transcripts.length === 0 ? <p className="ad-muted">Nobody has written this clip yet.</p> : (
            <ul className="ad-transcripts">
              {clip.transcripts.map((item) => (
                <li key={item.id}><span className="ad-who">{item.pseudonym}</span><span className="ad-text" lang="und">{item.text}</span></li>
              ))}
            </ul>
          )}
          {difference ? (
            <div className="ad-diff" aria-label="Differences">
              <p className="ad-diff-title">Differences <small>{difference.diff.similarity}% alike</small></p>
              <p className="ad-diff-line"><span className="ad-who">{difference.first.pseudonym}</span><Marked parts={difference.diff.left} /></p>
              <p className="ad-diff-line"><span className="ad-who">{difference.other.pseudonym}</span><Marked parts={difference.diff.right} /></p>
              <button className="secondary ad-small" onClick={() => onCopy(`clip-${clip.clipId}`, ['Which words are right? 🤔', '', clipDifferenceBlock(clip), '', 'Reply with the letter that is right, or write the correct words. Thank you!'].join('\n'))}>
                {copied === `clip-${clip.clipId}` ? 'Copied ✓' : `Copy for WhatsApp (${versions(clip).length} versions)`}
              </button>
            </div>
          ) : state === 'agree' ? <p className="ad-agree">Everyone wrote the same words.</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function Marked({ parts }: { parts: DiffPart[] }) {
  return <span className="ad-text">{parts.map((part, index) => (part.kind === 'changed' ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}</span>;
}
