import { useCallback, useEffect, useRef, useState } from 'react';

import type { Project } from '../../../src/features/projects/domain/project';
import type { Source } from '../../../server/src/sources/source';
import { ApiClient, ApiError } from '../api/client';
import { formatSeconds } from '../domain/clips-view';
import { exportCommand, formatDuration, transcriptsCsv } from '../domain/export-view';
import {
  approvedCount, batchProgress, clipBadge, clipDifferencesMessage, differencesMessage, firstDifference, percent, summarize, versions,
  type BatchResult, type ClipResult, type SourceResults,
} from '../domain/results-view';
import { clipLink } from '../domain/volunteer-view';
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
              <div className={totals.needLook > 0 ? 'ad-tile-alert' : ''}><dt>Need a look</dt><dd>{totals.needLook}</dd></div>
              <div><dt>Approved</dt><dd>{totals.approved}</dd></div>
            </dl>
          ) : null}

          <ul className="ad-batches">
            {results.batches.map((item) => (
              <BatchSection
                key={item.batch.id}
                client={client}
                onSaved={() => load()}
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
          <DatasetCard client={client} sourceId={source.id} approved={totals?.approved ?? 0} onError={setError} />
        </>
      )}
    </section>
  );
}

function BatchSection({ client, onSaved, item, required, open, openClip, playing, copied, onToggle, onOpenClip, onPlay, onCopy }: {
  client: ApiClient;
  onSaved: () => Promise<void>;
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
  // A closed batch no longer opens, so its clips get no listening link.
  const listenLink = item.batch.status === 'open' ? (clipId: string) => clipLink(window.location.origin, item.batch.id, item.token, clipId) : undefined;
  const message = differencesMessage(item.clips, required, listenLink);
  return (
    <li className="ad-batch">
      <button className="ad-batch-head" aria-expanded={open} onClick={onToggle}>
        <span className="ad-clip-name">
          {item.batch.title}
          <small>{progress.complete} of {progress.clips} clips done · {approvedCount(item)} approved · {item.volunteers} {item.volunteers === 1 ? 'volunteer' : 'volunteers'}</small>
        </span>
        {progress.differ > 0 ? <span className="ad-pill ad-pill-alert">{progress.differ} differ</span> : <span className={`ad-pill ${item.batch.status === 'open' ? '' : 'ad-pill-grey'}`}>{item.batch.status === 'open' ? 'Open' : 'Closed'}</span>}
      </button>
      <div className="ad-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(progress.answers, progress.needed)} aria-label={`${item.batch.title} progress`}>
        <span style={{ width: `${percent(progress.answers, progress.needed)}%` }} />
      </div>
      {open ? (
        <div className="ad-batch-body">
          <p className="ad-hint">{progress.answers} of {progress.needed} answers received. Each clip needs at least {required} different people. Up to 5 can write it, and it closes when you choose the final text.</p>
          <ul className="ad-results">
            {item.clips.map((clip) => (
              <ClipRow
                key={clip.clipId}
                client={client}
                onSaved={onSaved}
                clip={clip}
                required={required}
                open={openClip === clip.clipId}
                playing={playing === clip.clipId}
                copied={copied}
                onToggle={() => onOpenClip(clip.clipId)}
                onPlay={() => onPlay(clip)}
                onCopy={onCopy}
                listenLink={listenLink}
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

function ClipRow({ client, onSaved, clip, required, open, playing, copied, onToggle, onPlay, onCopy, listenLink }: {
  client: ApiClient;
  onSaved: () => Promise<void>;
  clip: ClipResult;
  required: number;
  open: boolean;
  playing: boolean;
  copied: string | null;
  onToggle: () => void;
  onPlay: () => void;
  onCopy: (key: string, text: string) => void;
  listenLink?: (clipId: string) => string;
}) {
  const badge = clipBadge(clip, required);
  const state = badge.kind;
  const difference = firstDifference(clip);
  const own = clip.status === 'withdrawn' ? ' · removed' : '';
  return (
    <li className={`ad-result ad-result-${state}`}>
      <div className="ad-result-head">
        <button className="ad-play ad-play-small" aria-label={`${playing ? 'Pause' : 'Play'} ${clip.clipKey}`} aria-pressed={playing} onClick={onPlay}>{playing ? '❚❚' : '▶'}</button>
        <button className="ad-result-main" aria-expanded={open} onClick={onToggle}>
          <span className="ad-clip-name">{clip.clipKey}<small>{formatSeconds(clip.durationMs)}{own}{clip.skips > 0 ? ` · ${clip.skips} skipped` : ''}</small></span>
          <span className={`ad-state ad-state-${state}`}>{badge.label}</span>
        </button>
      </div>
      {open ? (
        <div className="ad-result-body">
          {clip.transcripts.length === 0 ? <p className="ad-muted">Nobody has written this clip yet.</p> : (
            <ul className="ad-transcripts">
              {clip.transcripts.map((item) => (
                <li key={item.id}><span className="ad-who">{item.pseudonym}</span><span className="ad-text" lang="und">{item.text}{item.correction ? <small className="ad-note"> Forme proposée : <span lang="und">{item.correction}</span></small> : null}</span></li>
              ))}
            </ul>
          )}
          {difference ? (
            <div className="ad-diff" aria-label="Differences">
              <p className="ad-diff-title">Differences <small>{difference.diff.similarity}% alike</small></p>
              <p className="ad-diff-line"><span className="ad-who">{difference.first.pseudonym}</span><Marked parts={difference.diff.left} /></p>
              <p className="ad-diff-line"><span className="ad-who">{difference.other.pseudonym}</span><Marked parts={difference.diff.right} /></p>
              <button className="secondary ad-small" onClick={() => onCopy(`clip-${clip.clipId}`, clipDifferencesMessage(clip, listenLink))}>
                {copied === `clip-${clip.clipId}` ? 'Copied ✓' : `Copy for WhatsApp (${versions(clip).length} versions)`}
              </button>
            </div>
          ) : clip.transcripts.length >= required && clip.transcripts.every((item) => item.text === clip.transcripts[0]?.text) ? <p className="ad-agree">Everyone wrote the same words.</p> : null}
          <FinalEditor client={client} clip={clip} onSaved={onSaved} />
        </div>
      ) : null}
    </li>
  );
}

function Marked({ parts }: { parts: DiffPart[] }) {
  return <span className="ad-text">{parts.map((part, index) => (part.kind === 'changed' ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}</span>;
}

function FinalEditor({ client, clip, onSaved }: { client: ApiClient; clip: ClipResult; onSaved: () => Promise<void> }) {
  const final = clip.final;
  const options = versions(clip);
  const [editing, setEditing] = useState(final === null);
  const [text, setText] = useState(final?.text ?? (options.length === 1 ? options[0]?.text ?? '' : ''));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (decision: 'approved' | 'excluded') => {
    setBusy(true);
    setError(null);
    try {
      const chosen = decision === 'approved' ? clip.transcripts.find((item) => item.text === text.trim().replace(/\s+/g, ' ')) : undefined;
      await client.saveFinal(clip.clipId, {
        decision,
        ...(decision === 'approved' ? { text } : {}),
        ...(chosen ? { chosenSubmissionId: chosen.id } : {}),
        ...(note.trim() ? { note } : {}),
      });
      setNote('');
      setEditing(false);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  if (!editing && final) {
    return (
      <div className={`ad-final ad-final-${final.decision}`}>
        <p className="ad-who">Final text · version {final.version}</p>
        {final.decision === 'approved' ? <p className="ad-text" lang="und">{final.text}</p> : <p className="ad-muted">This clip is left out of the dataset.</p>}
        {final.note ? <p className="ad-hint">Note: {final.note}</p> : null}
        <button className="secondary ad-small" onClick={() => { setText(final.text ?? ''); setEditing(true); }}>Change</button>
      </div>
    );
  }

  return (
    <form className="ad-final-form" onSubmit={(event) => { event.preventDefault(); void save('approved'); }}>
      <p className="ad-who">{final ? `Change the final text (now version ${final.version})` : 'Final text'}</p>
      {options.length > 0 ? (
        <div className="ad-choices" role="group" aria-label="Use one of the answers">
          {options.map((option) => (
            <button key={option.label} type="button" className={`quiet ad-small${text === option.text ? ' ad-choice-on' : ''}`} onClick={() => setText(option.text)}>
              Use {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <label className="ad-field">
        <span>Text to keep</span>
        <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} autoCapitalize="off" />
      </label>
      <label className="ad-field">
        <span>Note <em>(optional, for example who confirmed it)</em></span>
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
      </label>
      {error ? <p className="ad-error" role="alert">{error}</p> : null}
      <div className="ad-actions">
        <button type="submit" disabled={busy || text.trim() === ''}>{busy ? 'Saving…' : 'Approve this text'}</button>
        <button type="button" className="quiet" disabled={busy} onClick={() => void save('excluded')}>Leave this clip out</button>
        {final ? <button type="button" className="quiet" disabled={busy} onClick={() => setEditing(false)}>Cancel</button> : null}
      </div>
      <p className="ad-hint">Earlier versions are kept. Nothing the volunteers wrote is changed.</p>
    </form>
  );
}

function DatasetCard({ client, sourceId, approved, onError }: { client: ApiClient; sourceId: string; approved: number; onError: (message: string) => void }) {
  const [busy, setBusy] = useState<'csv' | 'check' | null>(null);
  const [facts, setFacts] = useState<{ durationMs: number; excluded: number; notExported: number; shareable: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const manifest = await client.exportManifest(sourceId);
    setFacts({
      durationMs: manifest.totals.durationMs,
      excluded: manifest.totals.excluded,
      notExported: manifest.totals.notExported,
      shareable: manifest.rights?.authorizedUses?.publicDistribution === true,
    });
    return manifest;
  };

  const download = async () => {
    setBusy('csv');
    try {
      const manifest = await load();
      const blob = new Blob([transcriptsCsv(manifest)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${manifest.project.languageCode || 'dataset'}-transcripts.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not prepare the file.');
    } finally { setBusy(null); }
  };

  const check = async () => {
    setBusy('check');
    try { await load(); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not check.'); } finally { setBusy(null); }
  };

  const command = exportCommand(window.location.origin, sourceId);
  return (
    <section className="ad-card ad-dataset" aria-labelledby="dataset-title">
      <h2 id="dataset-title">Dataset</h2>
      <p className="ad-muted"><strong>{approved}</strong> {approved === 1 ? 'clip is' : 'clips are'} approved{facts ? ` · ${formatDuration(facts.durationMs)} of speech` : ''}.</p>
      {facts && facts.notExported > 0 ? <p className="ad-hint">{facts.notExported} approved {facts.notExported === 1 ? 'clip is' : 'clips are'} not exported because the clip was removed.</p> : null}
      {facts ? <p className="ad-hint">{facts.shareable ? 'Your permission allows sharing the finished dataset publicly.' : 'Your permission does not allow sharing the dataset publicly yet. Keep it private for now.'}</p> : null}
      <div className="ad-actions">
        <button disabled={busy !== null || approved === 0} onClick={() => void download()}>{busy === 'csv' ? 'Preparing…' : 'Download transcripts (CSV)'}</button>
        <button className="secondary" disabled={busy !== null} onClick={() => void check()}>{busy === 'check' ? 'Checking…' : 'Check hours and permission'}</button>
      </div>
      <details className="ad-help">
        <summary>Get the audio as WAV files</summary>
        <p>Run this on your computer. It downloads each approved clip, turns the FLAC back into WAV, checks every file, and writes the dataset folder.</p>
        <pre>{command}</pre>
        <button className="quiet ad-small" onClick={() => { void navigator.clipboard.writeText(command).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); }}>{copied ? 'Copied ✓' : 'Copy command'}</button>
      </details>
    </section>
  );
}
