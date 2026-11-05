import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  acceptClip, adjustClip, editReview, mergeWithNext, parseManifest, pausesInside, rejectClip, rejectReasons,
  reopenClip, reviewProgress, serializeManifest, speakerRoles, splitAtPause, splitClip, type SpeakerRole, type SegmentClip, type SegmentationManifest,
} from './domain/segmentation';
import { LocalSegmentationDraftRepository } from './domain/segmentation-draft';
import { createAudioView, parseWav16Mono, type AudioView } from './domain/wav';

type Filter = 'all' | 'todo' | 'accepted' | 'rejected' | 'flagged';
type Variant = 'original' | 'vocals';

const WARNING_FLAGS = ['too_short', 'over_target', 'needs_manual_split', 'clipping', 'low_speech_ratio', 'long_internal_pause'];
const FLAG_TEXT: Record<string, string> = {
  too_short: 'Very short', over_target: 'Longer than 12 s', needs_manual_split: 'Over 20 s: split it',
  clipping: 'Audio clipping', long_internal_pause: 'Long silence inside', low_speech_ratio: 'May be music or noise', tts_length_ok: 'TTS length',
};
const NUDGES = [-250, -50, 50, 250];
const TTS_PAUSE_CAP_MS = 500; // must match the export default (cut --max-pause-ms)
const REVIEWER_KEY = 'sautiforge.segmentation.reviewer';
const FILTER_LABEL: Record<Filter, string> = { all: 'All', todo: 'To do', flagged: 'Flagged', accepted: 'Accepted', rejected: 'Rejected' };

interface Loaded { original: AudioView; vocals: AudioView | null; originalUrl: string; vocalsUrl: string | null; source: SegmentationManifest }

export function SegmentationReview() {
  const repository = useMemo(() => new LocalSegmentationDraftRepository(window.localStorage), []);
  const picker = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [manifest, setManifest] = useState<SegmentationManifest | null>(null);
  const [variant, setVariant] = useState<Variant>('original');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [reviewer, setReviewer] = useState(() => { try { return window.localStorage.getItem(REVIEWER_KEY) ?? ''; } catch { return ''; } });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [adjustOpen, setAdjustOpen] = useState(false); // kept here because the editor remounts after every boundary change

  useEffect(() => () => {
    if (loaded) { URL.revokeObjectURL(loaded.originalUrl); if (loaded.vocalsUrl) URL.revokeObjectURL(loaded.vocalsUrl); }
  }, [loaded]);

  const open = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const list = Array.from(files);
      const manifestFile = list.find((file) => file.name.toLowerCase().endsWith('.json'));
      if (!manifestFile) throw new Error('Select the files from the output folder: manifest.json, audio_16k.wav and, if present, vocals_16k.wav.');
      const source = parseManifest(await manifestFile.text());
      const wavFile = list.find((file) => file.name === source.source.workingAudio);
      if (!wavFile) throw new Error(`This manifest needs ${source.source.workingAudio}. Select it together with manifest.json.`);
      const vocalsName = source.source.vocalsAudio;
      const vocalsFile = vocalsName ? list.find((file) => file.name === vocalsName) : undefined;
      if (vocalsName && !vocalsFile) throw new Error(`This manifest has cleaned-voice audio. Also select ${vocalsName}.`);

      const decode = async (file: File) => {
        const buffer = await file.arrayBuffer();
        const view = createAudioView(parseWav16Mono(buffer));
        if (Math.abs(view.durationMs - source.source.durationMs) > 1_500) throw new Error(`${file.name} does not match the manifest length. These files are from different runs.`);
        return { view, url: URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })) };
      };
      const original = await decode(wavFile);
      const vocals = vocalsFile ? await decode(vocalsFile) : null;

      let working = source;
      let restored = false;
      const draft = repository.load(source.source.sha256);
      if (draft) { working = draft; restored = true; }
      setLoaded((current) => {
        if (current) { URL.revokeObjectURL(current.originalUrl); if (current.vocalsUrl) URL.revokeObjectURL(current.vocalsUrl); }
        return { original: original.view, originalUrl: original.url, vocals: vocals?.view ?? null, vocalsUrl: vocals?.url ?? null, source };
      });
      setVariant(vocals ? 'vocals' : 'original');
      setManifest(working);
      setSelectedId(working.clips.find((clip) => clip.review.status === 'proposed')?.id ?? working.clips[0]?.id ?? null);
      setMessage(restored ? 'Restored your saved review for this video from this browser.' : `Opened ${source.clips.length} proposed clips. Nothing is uploaded.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The files could not be opened.');
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  };

  /** Apply an edit, then persist it with a verified write. */
  const apply = useCallback((change: (current: SegmentationManifest) => SegmentationManifest, success?: string) => {
    if (!manifest) return false;
    setError(null);
    let next: SegmentationManifest;
    try { next = change(manifest); } catch (cause) { setError(cause instanceof Error ? cause.message : 'That change is not allowed.'); return false; }
    setManifest(next);
    try { repository.save(next); setMessage(success ?? 'Saved in this browser.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The review could not be saved.'); }
    return true;
  }, [manifest, repository]);

  const clips = manifest?.clips ?? [];
  const visible = useMemo(() => clips.filter((clip) => {
    if (filter === 'todo') return clip.review.status === 'proposed';
    if (filter === 'accepted') return clip.review.status === 'accepted';
    if (filter === 'rejected') return clip.review.status === 'rejected';
    if (filter === 'flagged') return clip.flags.some((flag) => WARNING_FLAGS.includes(flag));
    return true;
  }), [clips, filter]);
  const selected = clips.find((clip) => clip.id === selectedId) ?? null;
  const selectedIndex = selected ? clips.indexOf(selected) : -1;
  const progress = manifest ? reviewProgress(manifest) : null;
  const shown = loaded ? (variant === 'vocals' && loaded.vocals ? loaded.vocals : loaded.original) : null;
  const shownUrl = loaded ? (variant === 'vocals' && loaded.vocalsUrl ? loaded.vocalsUrl : loaded.originalUrl) : undefined;

  // ---- playback ----
  const stop = useCallback(() => { audioRef.current?.pause(); setPlaying(false); }, []);
  const playFrom = useCallback((startMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = startMs / 1000;
    void audio.play().then(() => setPlaying(true)).catch(() => setError('The browser blocked audio playback. Press play again.'));
  }, []);

  useEffect(() => {
    if (!playing || !selected) return;
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      const audio = audioRef.current;
      if (audio) {
        const ms = audio.currentTime * 1000;
        if (ms >= selected.endMs) {
          if (loop) audio.currentTime = selected.startMs / 1000; else { audio.pause(); setPlaying(false); setPlayheadMs(selected.endMs); return; }
        }
        if (time - last > 50) { setPlayheadMs(Math.round(ms)); last = time; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, selected, loop]);

  useEffect(() => { stop(); if (selected) setPlayheadMs(selected.startMs); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = (ms: number) => { if (audioRef.current) audioRef.current.currentTime = ms / 1000; setPlayheadMs(Math.round(ms)); };
  const chooseVariant = (next: Variant) => { stop(); setVariant(next); };

  const download = () => {
    if (!manifest) return;
    try {
      const url = URL.createObjectURL(new Blob([serializeManifest(manifest)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'manifest.reviewed.json';
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setMessage('Downloaded manifest.reviewed.json. Put it in the same output folder, then run the cut command.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The manifest could not be downloaded.'); }
  };

  const resetDraft = () => {
    if (!loaded || !window.confirm('Discard all review work for this video in this browser and start again from the file you opened?')) return;
    try { repository.clear(loaded.source.source.sha256); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The draft could not be removed.'); return; }
    setManifest(loaded.source); setSelectedId(loaded.source.clips[0]?.id ?? null); setMessage('Review reset to the opened file.');
  };

  const rememberReviewer = (value: string) => { setReviewer(value); try { window.localStorage.setItem(REVIEWER_KEY, value); } catch { /* optional convenience */ } };
  /** Merge the selected clip into the one before it. The merged clip keeps the earlier clip's id, so select that. */
  const mergePrevious = () => {
    const previous = clips[selectedIndex - 1];
    if (previous && apply((current) => mergeWithNext(current, previous.id), 'Merged with the previous clip. Review it again.')) setSelectedId(previous.id);
  };
  const go = (offset: number) => { const target = clips[selectedIndex + offset]; if (target) setSelectedId(target.id); };

  return (
    <main className="seg-review">
      <input ref={picker} hidden multiple type="file" accept=".json,.wav,application/json,audio/wav" onChange={(event) => void open(event.target.files)} />

      <div className="seg-head">
        <div className="seg-title">
          <h2>Segment review</h2>
          {manifest ? (
            <span className="seg-file" title={manifest.source.fileName}>
              <span className="seg-file-name">{manifest.source.fileName}</span>
              <span className="seg-file-meta">{fmtDuration(manifest.source.durationMs)}</span>
            </span>
          ) : <p>Check the cut points, write the transcript, and decide which clips go into the dataset.</p>}
        </div>
        {manifest ? (
          <div className="header-actions">
            <button className="quiet" onClick={resetDraft}>Reset</button>
            <button className="secondary" disabled={busy} onClick={() => picker.current?.click()}>Open other files</button>
            <button onClick={download}>Download reviewed manifest</button>
          </div>
        ) : null}
      </div>

      {message ? <div className="save-message" role="status">{message}</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      {!manifest || !loaded || !progress || !shown ? (
        <section className="seg-empty">
          <h3>Open a segmentation run</h3>
          <p>Select these files together from the tool's output folder. They are read in your browser and never uploaded.</p>
          <ul>
            <li><code>manifest.json</code><span>the proposed clips</span></li>
            <li><code>audio_16k.wav</code><span>the original audio</span></li>
            <li><code>vocals_16k.wav</code><span>the cleaned voice, if music was removed</span></li>
          </ul>
          <button disabled={busy} onClick={() => picker.current?.click()}>{busy ? 'Opening…' : 'Choose files'}</button>
        </section>
      ) : (
        <>
          <section className="seg-summary" aria-label="Review progress">
            <div className="seg-numbers">
              <Stat label="Clips" value={progress.total} /><Stat label="To review" value={progress.proposed} />
              <Stat label="Accepted" value={progress.accepted} /><Stat label="TTS-ready" value={progress.tts} />
              <Stat label="Rejected" value={progress.rejected} /><Stat label="Kept audio" value={`${progress.acceptedSeconds.toFixed(0)} s`} />
            </div>
            <div className="seg-bar" role="img" aria-label={`${progress.accepted} accepted, ${progress.rejected} rejected, ${progress.proposed} to review`}>
              <span className="seg-bar-ok" style={{ width: `${(progress.accepted / progress.total) * 100}%` }} />
              <span className="seg-bar-no" style={{ width: `${(progress.rejected / progress.total) * 100}%` }} />
            </div>
            <label className="seg-reviewer"><span>Reviewer</span><input value={reviewer} onChange={(event) => rememberReviewer(event.target.value)} placeholder="Name or code" /></label>
          </section>

          <audio ref={audioRef} src={shownUrl} preload="auto" onEnded={() => setPlaying(false)} />

          <section className="seg-card seg-overview-card">
            <div className="seg-card-head">
              <h3>Whole video</h3>
              {loaded.vocals ? (
                <div className="seg-toggle" role="group" aria-label="Audio version">
                  <button aria-pressed={variant === 'vocals'} onClick={() => chooseVariant('vocals')}>Cleaned voice</button>
                  <button aria-pressed={variant === 'original'} onClick={() => chooseVariant('original')}>Original</button>
                </div>
              ) : null}
            </div>
            <Waveform audio={shown} manifest={manifest} selectedId={selectedId} playheadMs={playheadMs} onSelect={(id, ms) => { setSelectedId(id); seek(ms); }} />
            {loaded.vocals ? <p className="seg-hint">TTS clips are cut from the cleaned voice, so judge them there. ASR-only clips use the original, music included.</p> : null}
          </section>

          <div className="seg-grid">
            <aside className="seg-card seg-list">
              <div className="seg-filters" role="tablist" aria-label="Filter clips">
                {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
                  <button key={key} role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>{FILTER_LABEL[key]}</button>
                ))}
              </div>
              <p className="result-count">{visible.length} of {clips.length} clips</p>
              <div className="seg-items">
                {visible.map((clip) => {
                  const warnings = clip.flags.filter((flag) => WARNING_FLAGS.includes(flag));
                  return (
                    <button key={clip.id} className={`seg-item${clip.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(clip.id)}>
                      <i className={`dot dot-${clip.review.status}`} aria-hidden="true" />
                      <strong>{clip.id}</strong>
                      <span>{fmt(clip.startMs)} · {(clip.durationMs / 1000).toFixed(1)} s{clip.review.speakerRole ? ` · ${speakerRoles.find((role) => role.value === clip.review.speakerRole)?.label ?? ''}` : ''}</span>
                      <em>{clip.review.status === 'proposed' ? '' : clip.review.status === 'accepted' && clip.review.tier === 'asr_tts' ? 'accepted · TTS' : clip.review.status}</em>
                      {warnings.length ? <small>{warnings.map((flag) => FLAG_TEXT[flag] ?? flag).join(' · ')}</small> : null}
                    </button>
                  );
                })}
                {visible.length === 0 ? <p className="empty">No clips match this filter.</p> : null}
              </div>
            </aside>

            {selected ? (
              <ClipEditor key={`${selected.id}:${selected.startMs}:${selected.endMs}:${selected.review.status}`} hasVocals={Boolean(loaded.vocals)}
                clip={selected} manifest={manifest} audio={shown} playheadMs={playheadMs} playing={playing} loop={loop} reviewer={reviewer}
                hasPrev={selectedIndex > 0} hasNext={selectedIndex < clips.length - 1}
                onLoop={setLoop} onPlay={() => playFrom(selected.startMs)} onStop={stop} onSeek={seek} onPlayFrom={() => playFrom(playheadMs)}
                onPrev={() => go(-1)} onNext={() => go(1)} onMergePrevious={mergePrevious} adjustOpen={adjustOpen} onAdjustOpen={setAdjustOpen} apply={apply} />
            ) : <p className="empty">Select a clip.</p>}
          </div>
        </>
      )}
    </main>
  );
}

function ClipEditor({ hasVocals, clip, manifest, audio, playheadMs, playing, loop, reviewer, hasPrev, hasNext, onLoop, onPlay, onStop, onSeek, onPlayFrom, onPrev, onNext, onMergePrevious, adjustOpen, onAdjustOpen, apply }: {
  hasVocals: boolean; clip: SegmentClip; manifest: SegmentationManifest; audio: AudioView; playheadMs: number; playing: boolean; loop: boolean; reviewer: string;
  hasPrev: boolean; hasNext: boolean; onLoop: (value: boolean) => void; onPlay: () => void; onStop: () => void; onSeek: (ms: number) => void; onPlayFrom: () => void;
  onPrev: () => void; onNext: () => void; onMergePrevious: () => void; adjustOpen: boolean; onAdjustOpen: (open: boolean) => void; apply: (change: (current: SegmentationManifest) => SegmentationManifest, success?: string) => boolean;
}) {
  const review = clip.review;
  const [text, setText] = useState(review.transcript ?? '');
  const [speaker, setSpeaker] = useState(review.speaker ?? '');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<string>(rejectReasons[0]);
  const locked = review.status !== 'proposed';
  const editable = review.status !== 'rejected'; // notes, speaker and the TTS choice can change after accepting
  const [tts, setTts] = useState(review.tier === 'asr_tts');
  const pauses = useMemo(() => pausesInside(manifest, clip, TTS_PAUSE_CAP_MS), [manifest, clip]);

  const commitNotes = (patch: Partial<typeof review> = {}) =>
    apply((current) => editReview(current, clip.id, { transcript: text.trim() ? text : null, speaker: speaker.trim() || null, ...patch }), 'Notes saved in this browser.');

  const changeRole = (value: string) =>
    apply((current) => editReview(current, clip.id, { speakerRole: value ? (value as SpeakerRole) : null }), value ? `${clip.id}: speaker set.` : `${clip.id}: speaker cleared.`);

  // Before accepting, the box only sets the choice used on Accept. After accepting it saves at once, so a forgotten tick can be fixed without reopening the clip.
  const changeTts = (checked: boolean) => {
    setTts(checked);
    if (review.status !== 'accepted') return;
    apply((current) => editReview(current, clip.id, { tier: checked ? 'asr_tts' : 'asr', hasMusic: checked ? false : null }),
      checked ? `${clip.id} is now also used for TTS.` : `${clip.id} is now ASR only.`);
  };

  const accept = () => {
    const done = apply((current) => acceptClip(editReview(current, clip.id, { transcript: text.trim() ? text : null, speaker: speaker.trim() || null, tier: tts ? 'asr_tts' : 'asr', hasMusic: tts ? false : review.hasMusic }), clip.id, reviewer, new Date()), `${clip.id} accepted.`);
    if (done && hasNext) onNext();
  };
  const reject = () => {
    const done = apply((current) => rejectClip(current, clip.id, reason, reviewer, new Date()), `${clip.id} rejected.`);
    if (done) { setRejecting(false); if (hasNext) onNext(); }
  };
  const nudge = (edge: 'start' | 'end', delta: number) =>
    apply((current) => adjustClip(current, clip.id, clip.startMs + (edge === 'start' ? delta : 0), clip.endMs + (edge === 'end' ? delta : 0)), 'Boundary moved. Check it by ear.');

  const warnings = clip.flags.filter((flag) => WARNING_FLAGS.includes(flag));

  return (
    <section className="seg-card seg-editor">
      <header className="seg-editor-head">
        <div>
          <h3>{clip.id} <span className={`pill pill-${review.status}`}>{review.status}</span></h3>
          <p className="seg-sub">{fmt(clip.startMs)} → {fmt(clip.endMs)} · {(clip.durationMs / 1000).toFixed(2)} s · {clip.spanCount} phrase{clip.spanCount === 1 ? '' : 's'}</p>
        </div>
        <div className="compact-actions">
          <button className="quiet" disabled={!hasPrev} onClick={onPrev}>Previous</button>
          <button className="quiet" disabled={!hasNext} onClick={onNext}>Next</button>
        </div>
      </header>

      {warnings.length ? <p className="seg-flags">{warnings.map((flag) => <span key={flag} className="flag warn">{FLAG_TEXT[flag] ?? flag}</span>)}</p> : null}
      <ClipWave clip={clip} audio={audio} playheadMs={playheadMs} total={manifest.source.durationMs} onSeek={onSeek} />

      <div className="seg-transport">
        <button onClick={playing ? onStop : onPlay}>{playing ? 'Stop' : 'Play clip'}</button>
        <button className="secondary" onClick={onPlayFrom}>Play from marker</button>
        <label className="seg-check"><input type="checkbox" checked={loop} onChange={(event) => onLoop(event.target.checked)} /> Loop</label>
        <span className="seg-sub">Marker {fmt(playheadMs)} · click the waveform to move it</span>
      </div>

      <details className="seg-adjust" open={adjustOpen} onToggle={(event) => onAdjustOpen(event.currentTarget.open)}>
        <summary>Adjust the cut</summary>
        <div className="seg-nudge"><span>Trim to marker <b>{fmt(playheadMs)}</b></span>
          <button className="secondary" onClick={() => apply((current) => adjustClip(current, clip.id, playheadMs, clip.endMs), 'Start moved to the marker.')}>Start here</button>
          <button className="secondary" onClick={() => apply((current) => adjustClip(current, clip.id, clip.startMs, playheadMs), 'End moved to the marker. The audio after it is no longer in this clip.')}>End here</button>
          <small className="seg-sub">Click the waveform to place the marker, then trim.</small></div>
        {(['start', 'end'] as const).map((edge) => (
          <div key={edge} className="seg-nudge"><span>{edge === 'start' ? 'Start' : 'End'} <b>{fmt(edge === 'start' ? clip.startMs : clip.endMs)}</b></span>
            {NUDGES.map((delta) => <button key={delta} className="secondary" onClick={() => nudge(edge, delta)}>{delta > 0 ? '+' : ''}{delta} ms</button>)}</div>
        ))}
        <div className="seg-nudge"><span>Cut</span>
          <button className="secondary" onClick={() => apply((current) => splitClip(current, clip.id, playheadMs), 'Clip split at the marker. Review both parts.')}>Split at marker</button>
          {clip.cutCandidatesMs.map((at) => <button key={at} className="secondary" onClick={() => apply((current) => splitClip(current, clip.id, at), 'Clip split at the pause. Review both parts.')}>Split at pause {fmt(at)}</button>)}
          <button className="secondary" disabled={!hasPrev} onClick={onMergePrevious}>Merge with previous</button>
          <button className="secondary" disabled={!hasNext} onClick={() => apply((current) => mergeWithNext(current, clip.id), 'Merged with the next clip. Review it again.')}>Merge with next</button>
        </div>
      </details>

      {pauses.length ? (
        <div className="seg-pauses">
          <p><b>{pauses.length === 1 ? '1 silence' : `${pauses.length} silences`} inside this clip.</b> The TTS version shortens each to {TTS_PAUSE_CAP_MS / 1000} s; the original audio is not changed. If they separate two sentences, split and drop the silence instead.</p>
          <ul>
            {pauses.slice(0, 4).map((pause) => (
              <li key={pause.startMs}>
                <span>{(pause.lengthMs / 1000).toFixed(1)} s at {fmt(pause.startMs)}</span>
                <button className="secondary" disabled={locked} onClick={() => apply((current) => splitAtPause(current, clip.id, pause), 'Split and dropped the silence. Review both parts.')}>Split and drop</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasVocals ? (
        <label className="seg-tts">
          <input type="checkbox" checked={tts} disabled={!editable} onChange={(event) => changeTts(event.target.checked)} />
          <span><b>Also use for TTS</b><small>Tick only if the cleaned voice sounds clean: no music left and nothing robotic or watery. Every accepted clip is already used for ASR.</small></span>
        </label>
      ) : null}

      <div className="seg-speaker">
        <label className="field"><span>Who is speaking</span>
          <select value={review.speakerRole ?? ''} disabled={!editable} onChange={(event) => changeRole(event.target.value)}>
            <option value="">Not set</option>
            {speakerRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select></label>
        <label className="field"><span>Name or code (optional)</span>
          <input value={speaker} disabled={!editable} onChange={(event) => setSpeaker(event.target.value)} onBlur={() => editable && speaker.trim() !== (review.speaker ?? '') && commitNotes()}
            placeholder="e.g. Jesus, Peter, voice A" /></label>
      </div>

      <details className="seg-optional">
        <summary>Transcript (optional)</summary>
        <p className="seg-sub">Leave empty if community annotators will transcribe later.</p>
        <div className="seg-form">
          <label className="field"><span>What was actually spoken</span>
            <textarea rows={3} value={text} disabled={!editable} onChange={(event) => setText(event.target.value)} onBlur={() => editable && text.trim() !== (review.transcript ?? '') && commitNotes()}
              placeholder="Exactly as heard." /></label>
        </div>
      </details>

      {review.status === 'rejected' ? <p className="seg-sub">Rejected: {review.rejectReason}</p> : null}
      {rejecting ? (
        <div className="editor-actions"><label className="field seg-reason"><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value)}>{rejectReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button onClick={reject}>Confirm reject</button><button className="quiet" onClick={() => setRejecting(false)}>Cancel</button></div>
      ) : (
        <div className="editor-actions">
          {locked ? <button className="secondary" onClick={() => apply((current) => reopenClip(current, clip.id), `${clip.id} reopened.`)}>Reopen for editing</button>
            : <><button onClick={accept}>Accept and next</button><button className="quiet" onClick={() => setRejecting(true)}>Reject…</button></>}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="seg-stat"><strong>{value}</strong><span>{label}</span></div>;
}

function fmt(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const COLORS = { wave: '#7f978a', bg: '#f8faf8', proposed: 'rgba(224,166,41,.28)', accepted: 'rgba(23,107,69,.30)', rejected: 'rgba(166,55,55,.25)', selected: '#0f4d32', head: '#d6342f', cut: '#176b45' };

function useCanvas(draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, canvas.width, canvas.height);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

function drawPeaks(ctx: CanvasRenderingContext2D, peaks: Float32Array, width: number, height: number) {
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.wave;
  const mid = height / 2;
  for (let x = 0; x < width; x += 1) {
    const peak = peaks[Math.floor((x / width) * peaks.length)] ?? 0;
    const h = Math.max(1, peak * (height - 6));
    ctx.fillRect(x, mid - h / 2, 1, h);
  }
}

function Waveform({ audio, manifest, selectedId, playheadMs, onSelect }: {
  audio: AudioView; manifest: SegmentationManifest; selectedId: string | null; playheadMs: number; onSelect: (id: string, ms: number) => void;
}) {
  const total = manifest.source.durationMs;
  const peaks = useMemo(() => audio.peaks(0, total, 1600), [audio, total]);
  const ref = useCanvas((ctx, width, height) => {
    drawPeaks(ctx, peaks, width, height);
    for (const clip of manifest.clips) {
      const x = (clip.startMs / total) * width; const w = Math.max(2, ((clip.endMs - clip.startMs) / total) * width);
      ctx.fillStyle = COLORS[clip.review.status]; ctx.fillRect(x, 0, w, height);
      if (clip.id === selectedId) { ctx.strokeStyle = COLORS.selected; ctx.lineWidth = 3; ctx.strokeRect(x, 1, w, height - 2); }
    }
    ctx.fillStyle = COLORS.head; ctx.fillRect((playheadMs / total) * width - 1, 0, 2, height);
  }, [peaks, manifest, selectedId, playheadMs, total]);
  const click = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ms = Math.round(((event.clientX - rect.left) / rect.width) * total);
    const hit = manifest.clips.find((clip) => ms >= clip.startMs && ms <= clip.endMs)
      ?? [...manifest.clips].sort((a, b) => Math.abs(a.startMs - ms) - Math.abs(b.startMs - ms))[0];
    if (hit) onSelect(hit.id, Math.min(Math.max(ms, hit.startMs), hit.endMs));
  };
  return <canvas ref={ref} className="seg-overview" width={1600} height={110} onClick={click} aria-label="Whole video waveform. Click a clip to select it." />;
}

function ClipWave({ clip, audio, playheadMs, total, onSeek }: { clip: SegmentClip; audio: AudioView; playheadMs: number; total: number; onSeek: (ms: number) => void }) {
  const from = Math.max(0, clip.startMs - 1_500);
  const to = Math.min(total, clip.endMs + 1_500);
  const peaks = useMemo(() => audio.peaks(from, to, 1200), [audio, from, to]);
  const at = (ms: number, width: number) => ((ms - from) / (to - from)) * width;
  const ref = useCanvas((ctx, width, height) => {
    drawPeaks(ctx, peaks, width, height);
    ctx.fillStyle = 'rgba(23,107,69,.14)'; ctx.fillRect(at(clip.startMs, width), 0, at(clip.endMs, width) - at(clip.startMs, width), height);
    ctx.fillStyle = COLORS.selected; ctx.fillRect(at(clip.startMs, width) - 1, 0, 3, height); ctx.fillRect(at(clip.endMs, width) - 1, 0, 3, height);
    ctx.fillStyle = COLORS.cut;
    for (const cut of clip.cutCandidatesMs) for (let y = 0; y < height; y += 10) ctx.fillRect(at(cut, width), y, 2, 5);
    ctx.fillStyle = COLORS.head; ctx.fillRect(at(playheadMs, width) - 1, 0, 2, height);
  }, [peaks, clip, playheadMs, from, to]);
  const click = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.round(from + ((event.clientX - rect.left) / rect.width) * (to - from)));
  };
  return <canvas ref={ref} className="seg-detail" width={1200} height={150} onClick={click} aria-label="Selected clip waveform with 1.5 seconds of context. Click to place the marker." />;
}
