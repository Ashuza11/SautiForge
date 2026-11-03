import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  acceptClip, acceptanceProblems, adjustClip, editReview, mergeWithNext, parseManifest, rejectClip, rejectReasons,
  reopenClip, reviewProgress, serializeManifest, splitClip, type SegmentClip, type SegmentationManifest,
} from './domain/segmentation';
import { LocalSegmentationDraftRepository } from './domain/segmentation-draft';
import { parseWav16Mono, peakEnvelope, type WavAudio } from './domain/wav';

type Filter = 'all' | 'todo' | 'accepted' | 'rejected' | 'flagged';
const WARNING_FLAGS = ['too_short', 'over_target', 'needs_manual_split', 'clipping', 'low_speech_ratio', 'long_internal_pause'];
const FLAG_TEXT: Record<string, string> = {
  too_short: 'Very short', over_target: 'Longer than 12 s', needs_manual_split: 'Over 20 s: split it',
  clipping: 'Audio clipping', long_internal_pause: 'Long silence inside', low_speech_ratio: 'May be music or noise', tts_length_ok: 'TTS length',
};
const NUDGES = [-250, -50, 50, 250];
const REVIEWER_KEY = 'sautiforge.segmentation.reviewer';

export function SegmentationReview({ onClose }: { onClose: () => void }) {
  const repository = useMemo(() => new LocalSegmentationDraftRepository(window.localStorage), []);
  const picker = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [loaded, setLoaded] = useState<{ audio: WavAudio; audioUrl: string; vocals: { audio: WavAudio; url: string } | null; original: SegmentationManifest } | null>(null);
  const [variant, setVariant] = useState<'original' | 'vocals'>('original');
  const [manifest, setManifest] = useState<SegmentationManifest | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [reviewer, setReviewer] = useState(() => { try { return window.localStorage.getItem(REVIEWER_KEY) ?? ''; } catch { return ''; } });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);

  useEffect(() => () => { if (loaded) { URL.revokeObjectURL(loaded.audioUrl); if (loaded.vocals) URL.revokeObjectURL(loaded.vocals.url); } }, [loaded]);

  const open = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const list = Array.from(files);
      const manifestFile = list.find((file) => file.name.toLowerCase().endsWith('.json'));
      if (!manifestFile) throw new Error('Select the files from the output folder: manifest.json, audio_16k.wav and, if present, vocals_16k.wav.');
      const original = parseManifest(await manifestFile.text());
      const wavFile = list.find((file) => file.name === original.source.workingAudio);
      if (!wavFile) throw new Error(`This manifest needs ${original.source.workingAudio}. Select it together with manifest.json.`);
      const vocalsName = original.source.vocalsAudio;
      const vocalsFile = vocalsName ? list.find((file) => file.name === vocalsName) : undefined;
      if (vocalsName && !vocalsFile) throw new Error(`This manifest has cleaned-voice audio. Also select ${vocalsName}.`);
      const checkLength = (wav: WavAudio, name: string) => {
        if (Math.abs((wav.samples.length / wav.sampleRate) * 1000 - original.source.durationMs) > 1_500) throw new Error(`${name} does not match the manifest length. These files are from different runs.`);
      };
      const buffer = await wavFile.arrayBuffer();
      const audio = parseWav16Mono(buffer);
      checkLength(audio, wavFile.name);
      let vocals: { audio: WavAudio; url: string } | null = null;
      if (vocalsFile) {
        const vocalsBuffer = await vocalsFile.arrayBuffer();
        const vocalsAudio = parseWav16Mono(vocalsBuffer);
        checkLength(vocalsAudio, vocalsFile.name);
        vocals = { audio: vocalsAudio, url: URL.createObjectURL(new Blob([vocalsBuffer], { type: 'audio/wav' })) };
      }
      let working = original;
      let restored = false;
      const draft = repository.load(original.source.sha256);
      if (draft) { working = draft; restored = true; }
      const audioUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
      setLoaded((current) => { if (current) { URL.revokeObjectURL(current.audioUrl); if (current.vocals) URL.revokeObjectURL(current.vocals.url); } return { audio, audioUrl, vocals, original }; });
      setVariant(vocals ? 'vocals' : 'original');
      setManifest(working);
      setSelectedId(working.clips.find((clip) => clip.review.status === 'proposed')?.id ?? working.clips[0]?.id ?? null);
      setMessage(restored ? 'Restored your saved review for this video from this browser.' : `Opened ${original.clips.length} proposed clips. Nothing is uploaded.`);
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

  const shownAudio = loaded ? (variant === 'vocals' && loaded.vocals ? loaded.vocals.audio : loaded.audio) : null;
  const shownUrl = loaded ? (variant === 'vocals' && loaded.vocals ? loaded.vocals.url : loaded.audioUrl) : undefined;
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

  // ---- playback ----
  const stop = useCallback(() => { audioRef.current?.pause(); setPlaying(false); }, []);
  const playRange = useCallback((startMs: number) => {
    const audio = audioRef.current;
    if (!audio || !selected) return;
    audio.currentTime = startMs / 1000;
    void audio.play().then(() => setPlaying(true)).catch(() => setError('The browser blocked audio playback. Press play again.'));
  }, [selected]);

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

  const download = () => {
    if (!manifest) return;
    try {
      const url = URL.createObjectURL(new Blob([serializeManifest(manifest)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'manifest.reviewed.json';
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setMessage('Downloaded manifest.reviewed.json. Put it in the same output folder and run the cut command.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The manifest could not be downloaded.'); }
  };

  const resetDraft = () => {
    if (!loaded || !window.confirm('Discard all review work for this video in this browser and start again from the file you opened?')) return;
    try { repository.clear(loaded.original.source.sha256); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The draft could not be removed.'); return; }
    setManifest(loaded.original); setSelectedId(loaded.original.clips[0]?.id ?? null); setMessage('Review reset to the opened file.');
  };

  const rememberReviewer = (value: string) => { setReviewer(value); try { window.localStorage.setItem(REVIEWER_KEY, value); } catch { /* optional convenience */ } };

  const go = (offset: number) => {
    const target = clips[selectedIndex + offset];
    if (target) setSelectedId(target.id);
  };

  return (
    <main className="seg-review">
      <input ref={picker} hidden multiple type="file" accept=".json,.wav,application/json,audio/wav" onChange={(event) => void open(event.target.files)} />
      <div className="seg-head">
        <div>
          <p className="eyebrow">Segmentation review</p>
          <h2>{manifest ? manifest.source.fileName : 'Review proposed speech clips'}</h2>
          {!manifest ? <p className="seg-lead">Open the files the segmentation tool wrote: <code>manifest.json</code>, <code>audio_16k.wav</code> and, when music was removed, <code>vocals_16k.wav</code>. They are read on this device and never uploaded.</p> : null}
        </div>
        <div className="header-actions">
          <button className="secondary" disabled={busy} onClick={() => picker.current?.click()}>{manifest ? 'Open other files' : busy ? 'Opening…' : 'Choose manifest and audio'}</button>
          {manifest ? <><button onClick={download}>Download reviewed manifest</button><button className="quiet" onClick={resetDraft}>Reset review</button></> : null}
          <button className="quiet" onClick={onClose}>Back</button>
        </div>
      </div>
      {message ? <div className="save-message" role="status">{message}</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      {manifest && loaded && progress ? (
        <>
          <div className="seg-progress" aria-label="Review progress">
            <Stat label="Clips" value={progress.total} /><Stat label="To review" value={progress.proposed} />
            <Stat label="Accepted" value={progress.accepted} /><Stat label="TTS-ready" value={progress.tts} />
            <Stat label="Rejected" value={progress.rejected} /><Stat label="Accepted time" value={`${progress.acceptedSeconds.toFixed(0)} s`} />
            <label className="field seg-reviewer"><span>Reviewer</span><input value={reviewer} onChange={(event) => rememberReviewer(event.target.value)} placeholder="Your name or code" /></label>
          </div>
          {loaded.vocals ? (
            <div className="seg-variant" role="group" aria-label="Audio version">
              <span>Listen to</span>
              <button className={variant === 'vocals' ? '' : 'secondary'} onClick={() => { stop(); setVariant('vocals'); }}>Cleaned voice (music removed)</button>
              <button className={variant === 'original' ? '' : 'secondary'} onClick={() => { stop(); setVariant('original'); }}>Original (with music)</button>
              <small>TTS clips are cut from the cleaned voice, so judge them there. ASR-only clips use the original.</small>
            </div>
          ) : null}
          <audio ref={audioRef} src={shownUrl} preload="auto" onEnded={() => setPlaying(false)} />
          <Waveform audio={shownAudio ?? loaded.audio} manifest={manifest} selectedId={selectedId} playheadMs={playheadMs} onSelect={(id, ms) => { setSelectedId(id); seek(ms); }} />
          <div className="seg-grid">
            <aside className="seg-list">
              <label className="field"><span>Show</span>
                <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
                  <option value="all">All clips</option><option value="todo">Needs review</option><option value="flagged">Needs attention</option>
                  <option value="accepted">Accepted</option><option value="rejected">Rejected</option>
                </select>
              </label>
              <p className="result-count">{visible.length} of {clips.length} clips</p>
              <div className="seg-items">
                {visible.map((clip) => (
                  <button key={clip.id} className={`seg-item seg-${clip.review.status}${clip.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(clip.id)}>
                    <strong>{clip.id}</strong><span>{fmt(clip.startMs)} · {(clip.durationMs / 1000).toFixed(1)} s</span>
                    <em>{clip.review.status}</em>
                    {clip.flags.some((flag) => WARNING_FLAGS.includes(flag)) ? <small>⚠ {clip.flags.filter((flag) => WARNING_FLAGS.includes(flag)).map((flag) => FLAG_TEXT[flag] ?? flag).join(', ')}</small> : null}
                  </button>
                ))}
                {visible.length === 0 ? <p className="empty">No clips match this filter.</p> : null}
              </div>
            </aside>
            {selected ? (
              <ClipEditor hasVocals={Boolean(loaded.vocals)} key={`${selected.id}:${selected.startMs}:${selected.endMs}:${selected.review.status}`} clip={selected} manifest={manifest} audio={shownAudio ?? loaded.audio} playheadMs={playheadMs} playing={playing} loop={loop}
                reviewer={reviewer} hasPrev={selectedIndex > 0} hasNext={selectedIndex < clips.length - 1}
                onLoop={setLoop} onPlay={() => playRange(selected.startMs)} onStop={stop} onSeek={seek} onPlayFrom={() => playRange(playheadMs)}
                onPrev={() => go(-1)} onNext={() => go(1)} apply={apply} />
            ) : <p className="empty">Select a clip.</p>}
          </div>
        </>
      ) : null}
    </main>
  );
}

function ClipEditor({ hasVocals, clip, manifest, audio, playheadMs, playing, loop, reviewer, hasPrev, hasNext, onLoop, onPlay, onStop, onSeek, onPlayFrom, onPrev, onNext, apply }: {
  hasVocals: boolean; clip: SegmentClip; manifest: SegmentationManifest; audio: WavAudio; playheadMs: number; playing: boolean; loop: boolean; reviewer: string;
  hasPrev: boolean; hasNext: boolean; onLoop: (value: boolean) => void; onPlay: () => void; onStop: () => void; onSeek: (ms: number) => void; onPlayFrom: () => void;
  onPrev: () => void; onNext: () => void; apply: (change: (current: SegmentationManifest) => SegmentationManifest, success?: string) => boolean;
}) {
  const review = clip.review;
  const [text, setText] = useState(review.transcript ?? '');
  const [speaker, setSpeaker] = useState(review.speaker ?? '');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<string>(rejectReasons[0]);
  const locked = review.status !== 'proposed';
  const problems = acceptanceProblems({ ...review, transcript: text, speaker });

  const commitNotes = (patch: Partial<typeof review> = {}) =>
    apply((current) => editReview(current, clip.id, { transcript: text.trim() ? text : null, speaker: speaker.trim() || null, ...patch }), 'Notes saved in this browser.');

  const accept = () => {
    const done = apply((current) => acceptClip(editReview(current, clip.id, { transcript: text, speaker: speaker.trim() || null }), clip.id, reviewer, new Date()), `${clip.id} accepted.`);
    if (done && hasNext) onNext();
  };
  const reject = () => {
    const done = apply((current) => rejectClip(current, clip.id, reason, reviewer, new Date()), `${clip.id} rejected.`);
    if (done) { setRejecting(false); if (hasNext) onNext(); }
  };

  const nudge = (edge: 'start' | 'end', delta: number) =>
    apply((current) => adjustClip(current, clip.id, clip.startMs + (edge === 'start' ? delta : 0), clip.endMs + (edge === 'end' ? delta : 0)), 'Boundary moved. Check it by ear.');

  const candidates = clip.cutCandidatesMs;
  const metrics = clip.metrics;

  return (
    <section className="seg-editor">
      <div className="editor-heading">
        <div><h3>{clip.id} <span className={`status status-${review.status === 'accepted' ? 'validated' : review.status}`}>{review.status}</span></h3>
          <p className="seg-sub">{fmt(clip.startMs)} → {fmt(clip.endMs)} · {(clip.durationMs / 1000).toFixed(2)} s · {clip.spanCount} phrase{clip.spanCount === 1 ? '' : 's'}</p></div>
        <div className="compact-actions"><button className="secondary" disabled={!hasPrev} onClick={onPrev}>Previous</button><button className="secondary" disabled={!hasNext} onClick={onNext}>Next</button></div>
      </div>

      {clip.flags.length ? <p className="seg-flags">{clip.flags.map((flag) => <span key={flag} className={WARNING_FLAGS.includes(flag) ? 'flag warn' : 'flag'}>{FLAG_TEXT[flag] ?? flag}</span>)}</p> : null}
      <ClipWave clip={clip} audio={audio} playheadMs={playheadMs} total={manifest.source.durationMs} onSeek={onSeek} />

      <div className="seg-controls">
        <button onClick={playing ? onStop : onPlay}>{playing ? 'Stop' : 'Play clip'}</button>
        <button className="secondary" onClick={onPlayFrom}>Play from marker</button>
        <label className="seg-check"><input type="checkbox" checked={loop} onChange={(event) => onLoop(event.target.checked)} /> Loop</label>
        <span className="seg-sub">Marker {fmt(playheadMs)}. Click the waveform to move it.</span>
      </div>

      <div className="seg-bounds">
        {(['start', 'end'] as const).map((edge) => (
          <div key={edge} className="seg-nudge"><span>{edge === 'start' ? 'Start' : 'End'} {fmt(edge === 'start' ? clip.startMs : clip.endMs)}</span>
            {NUDGES.map((delta) => <button key={delta} className="secondary" onClick={() => nudge(edge, delta)}>{delta > 0 ? '+' : ''}{delta} ms</button>)}</div>
        ))}
        <div className="seg-nudge"><span>Cut</span>
          <button className="secondary" onClick={() => apply((current) => splitClip(current, clip.id, playheadMs), 'Clip split at the marker. Review both parts.')}>Split at marker</button>
          {candidates.map((at) => <button key={at} className="secondary" onClick={() => apply((current) => splitClip(current, clip.id, at), 'Clip split at the pause. Review both parts.')}>Split at pause {fmt(at)}</button>)}
          <button className="secondary" disabled={!hasNext} onClick={() => apply((current) => mergeWithNext(current, clip.id), 'Merged with the next clip. Review it again.')}>Merge with next</button>
        </div>
      </div>

      <div className="seg-metrics">
        {metrics.meanSpeechProb !== undefined ? <span>Speech confidence {(metrics.meanSpeechProb * 100).toFixed(0)}%</span> : null}
        {metrics.speechRatio !== undefined ? <span>Speech share {(metrics.speechRatio * 100).toFixed(0)}%</span> : null}
        {metrics.rmsDb !== undefined ? <span>Level {metrics.rmsDb} dB</span> : null}
      </div>

      <label className="field"><span>What was actually spoken (verbatim)</span>
        <textarea rows={4} value={text} disabled={locked} onChange={(event) => setText(event.target.value)} onBlur={() => !locked && commitNotes()} placeholder="Type the Mashi exactly as heard. Do not copy subtitles or a script unless it matches the audio." /></label>
      <div className="form-grid">
        <label className="field"><span>Speaker (optional)</span><input value={speaker} disabled={locked} onChange={(event) => setSpeaker(event.target.value)} onBlur={() => !locked && commitNotes()} placeholder="e.g. narrator, voice A" /></label>
        <label className="field"><span>Music under the voice{hasVocals ? ' (check the cleaned voice)' : ''}</span>
          <select value={review.hasMusic === null ? 'unknown' : review.hasMusic ? 'yes' : 'no'} disabled={locked}
            onChange={(event) => commitNotes({ hasMusic: event.target.value === 'unknown' ? null : event.target.value === 'yes' })}>
            <option value="unknown">Not checked</option><option value="no">No music heard</option><option value="yes">Music audible</option>
          </select></label>
        <label className="field"><span>Dataset tier</span>
          <select value={review.tier ?? ''} disabled={locked} onChange={(event) => commitNotes({ tier: event.target.value ? (event.target.value as 'asr' | 'asr_tts') : null })}>
            <option value="">Choose…</option><option value="asr">ASR only (music allowed)</option><option value="asr_tts">ASR and TTS (clean, no music)</option>
          </select></label>
      </div>

      {review.status === 'rejected' ? <p className="seg-sub">Rejected: {review.rejectReason}</p> : null}
      {!locked && problems.length ? <p className="seg-sub">To accept: {problems.join(' ')}</p> : null}
      {rejecting ? (
        <div className="editor-actions"><label className="field"><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value)}>{rejectReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button onClick={reject}>Confirm reject</button><button className="quiet" onClick={() => setRejecting(false)}>Cancel</button></div>
      ) : (
        <div className="editor-actions">
          {locked ? <button className="secondary" onClick={() => apply((current) => reopenClip(current, clip.id), `${clip.id} reopened.`)}>Reopen for editing</button>
            : <><button disabled={problems.length > 0} onClick={accept}>Accept and next</button><button className="quiet" onClick={() => setRejecting(true)}>Reject…</button></>}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}

function fmt(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total - minutes * 60).toFixed(2).padStart(5, '0')}`;
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
  audio: WavAudio; manifest: SegmentationManifest; selectedId: string | null; playheadMs: number; onSelect: (id: string, ms: number) => void;
}) {
  const total = manifest.source.durationMs;
  const peaks = useMemo(() => peakEnvelope(audio, 0, total, 1600), [audio, total]);
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

function ClipWave({ clip, audio, playheadMs, total, onSeek }: { clip: SegmentClip; audio: WavAudio; playheadMs: number; total: number; onSeek: (ms: number) => void }) {
  const from = Math.max(0, clip.startMs - 1_500);
  const to = Math.min(total, clip.endMs + 1_500);
  const peaks = useMemo(() => peakEnvelope(audio, from, to, 1200), [audio, from, to]);
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
