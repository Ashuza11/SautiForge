import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { VolunteerApiError, VolunteerClient, type BatchInfo, type NextResult } from '../api/volunteer-client';
import {
  clearContributor, clearDraft, loadContributor, loadDraft, nextSpeed, nicknameProblem, progressPercent,
  saveContributor, saveDraft, speedLabel, type SavedContributor, type Speed,
} from '../domain/volunteer-view';

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'offline'; message: string }
  | { kind: 'welcome'; info: BatchInfo }
  | { kind: 'working'; info: BatchInfo; me: SavedContributor };

export function VolunteerApp({ link }: { link: string }) {
  const client = useMemo(() => new VolunteerClient(link), [link]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const start = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const info = await client.info();
      const me = loadContributor();
      setPhase(me ? { kind: 'working', info, me } : { kind: 'welcome', info });
    } catch (cause) {
      if (cause instanceof VolunteerApiError && cause.status === 0) setPhase({ kind: 'offline', message: cause.message });
      else setPhase({ kind: 'invalid', message: cause instanceof Error ? cause.message : 'This link is not valid.' });
    }
  }, [client]);
  useEffect(() => { void start(); }, [start]);

  return (
    <div className="vo-shell">
      <header className="vo-header">
        <span className="vo-mark" aria-hidden="true">S</span>
        <strong>SautiForge</strong>
        {phase.kind === 'working' ? (
          <span className="vo-me">
            {phase.me.pseudonym}
            <button className="vo-linkbutton" onClick={() => { clearContributor(); void start(); }}>Not you?</button>
          </span>
        ) : null}
      </header>
      <main className="vo-main">
        {phase.kind === 'loading' ? <p className="vo-muted" role="status">One moment…</p> : null}
        {phase.kind === 'invalid' ? <Notice title="This link does not work" message={phase.message} /> : null}
        {phase.kind === 'offline' ? <Notice title="No connection" message={phase.message} action={{ label: 'Try again', run: () => void start() }} /> : null}
        {phase.kind === 'welcome' ? (
          <Welcome
            info={phase.info}
            client={client}
            onJoined={(me) => { saveContributor(me); setPhase({ kind: 'working', info: phase.info, me }); }}
          />
        ) : null}
        {phase.kind === 'working' ? (
          <Listening client={client} me={phase.me} onSignedOut={() => { clearContributor(); void start(); }} />
        ) : null}
      </main>
    </div>
  );
}

function Notice({ title, message, action }: { title: string; message: string; action?: { label: string; run: () => void } }) {
  return (
    <section className="vo-card">
      <h1>{title}</h1>
      <p className="vo-muted">{message}</p>
      {action ? <button className="vo-primary" onClick={action.run}>{action.label}</button> : null}
    </section>
  );
}

function Welcome({ info, client, onJoined }: { info: BatchInfo; client: VolunteerClient; onJoined: (me: SavedContributor) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const problem = nicknameProblem(name);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      const joined = await client.join(name);
      onJoined({ token: joined.token, pseudonym: joined.contributor.pseudonym });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="vo-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h1>Help write down {info.language || 'our language'}</h1>
      <ol className="vo-steps">
        <li>Listen to a short clip.</li>
        <li>Type what you hear.</li>
        <li>Send it. There are {info.clipCount} clips, and you can stop at any time.</li>
      </ol>
      <label className="vo-field">
        <span>Choose a nickname</span>
        <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" autoCapitalize="words" maxLength={40} aria-describedby="nick-hint" />
      </label>
      <p id="nick-hint" className="vo-hint">Use a nickname, not your real name or phone number. No account is needed.</p>
      {error ? <p className="vo-error" role="alert">{error}</p> : null}
      <button className="vo-primary" type="submit" disabled={busy || name.trim().length < 2}>{busy ? 'One moment…' : 'Start'}</button>
    </form>
  );
}

function Listening({ client, me, onSignedOut }: { client: VolunteerClient; me: SavedContributor; onSignedOut: () => void }) {
  const [state, setState] = useState<NextResult | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [sentCount, setSentCount] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const refetched = useRef(false);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof VolunteerApiError && cause.status === 401) { onSignedOut(); return; }
    setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : 'Something went wrong.' });
  }, [onSignedOut]);

  const load = useCallback(async () => {
    try {
      const result = await client.next(me.token);
      refetched.current = false;
      setState(result);
      setText(result.clip ? loadDraft(result.clip.clipId) : '');
    } catch (cause) {
      fail(cause);
    }
  }, [client, me.token, fail]);
  useEffect(() => { void load(); }, [load]);

  const clip = state?.clip ?? null;

  // A new clip starts from the beginning at normal care: reset playing state when the file changes.
  useEffect(() => { setPlaying(false); }, [clip?.clipId]);
  useEffect(() => {
    const element = audio.current;
    if (element) { element.defaultPlaybackRate = speed; element.playbackRate = speed; }
  }, [speed, clip?.clipId]);

  const toggle = async () => {
    const element = audio.current;
    if (!element || !clip) return;
    if (!element.paused) { element.pause(); return; }
    try { element.playbackRate = speed; await element.play(); setMessage(null); } catch {
      setMessage({ kind: 'error', text: 'The sound could not be played. Check your connection and tap Listen again.' });
    }
  };

  const again = async () => {
    const element = audio.current;
    if (!element) return;
    element.currentTime = 0;
    try { element.playbackRate = speed; await element.play(); } catch { /* the Listen button is still there */ }
  };

  const onAudioError = () => {
    // The listening link lasts 15 minutes; ask for a fresh one once.
    if (refetched.current) { setMessage({ kind: 'error', text: 'This sound could not be loaded. Please try again in a moment.' }); return; }
    refetched.current = true;
    void load();
  };

  const change = (value: string) => {
    setText(value);
    if (clip) saveDraft(clip.clipId, value);
  };

  const send = async () => {
    if (!clip || text.trim() === '') return;
    setSending(true);
    setMessage(null);
    try {
      await client.submit(me.token, clip.clipId, text);
      clearDraft(clip.clipId);
      setSentCount((count) => count + 1);
      setMessage({ kind: 'ok', text: 'Sent. Thank you!' });
      await load();
    } catch (cause) {
      fail(cause);
    } finally {
      setSending(false);
    }
  };

  const skip = async () => {
    if (!clip) return;
    setSending(true);
    setMessage(null);
    try {
      await client.skip(me.token, clip.clipId);
      clearDraft(clip.clipId);
      await load();
    } catch (cause) {
      fail(cause);
    } finally {
      setSending(false);
    }
  };

  if (!state) return <p className="vo-muted" role="status">{message ? '' : 'Finding your clip…'}{message ? <span className="vo-error" role="alert">{message.text}</span> : null}</p>;

  if (!clip) {
    return (
      <section className="vo-card vo-done">
        <div className="vo-check" aria-hidden="true">✓</div>
        <h1>Thank you, {me.pseudonym}!</h1>
        <p className="vo-muted">
          {state.progress.answered > 0 ? `You have answered ${state.progress.answered} of ${state.progress.total} clips. ` : ''}
          There are no more clips for you in this batch. More will come soon. Please share the link with someone who speaks the language.
        </p>
      </section>
    );
  }

  const percent = progressPercent(state.progress.answered, state.progress.total);

  return (
    <section className="vo-card" aria-labelledby="clip-title">
      <p className="vo-progress-text" id="clip-title">Clip {Math.min(state.progress.answered + 1, state.progress.total)} of {state.progress.total}</p>
      <div className="vo-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Your progress"><span style={{ width: `${percent}%` }} /></div>

      <audio
        ref={audio}
        src={clip.audioUrl}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={onAudioError}
      />
      <button className="vo-listen" onClick={() => void toggle()} aria-pressed={playing}>
        <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        {playing ? 'Pause' : 'Listen'}
      </button>
      <div className="vo-tools">
        <button className="secondary vo-secondary" onClick={() => void again()}>↺ Again</button>
        <button className="secondary vo-secondary" onClick={() => setSpeed(nextSpeed(speed))}>Speed: {speedLabel(speed)}</button>
      </div>

      <label className="vo-field">
        <span>Write what you hear</span>
        <textarea
          rows={4}
          value={text}
          onChange={(event) => change(event.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          placeholder="Type here…"
        />
      </label>
      <p className="vo-hint">Write the words exactly as you hear them. Your writing is saved on this phone while you type.</p>

      <div aria-live="polite">
        {message ? <p className={message.kind === 'error' ? 'vo-error' : 'vo-ok'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
      </div>
      <button className="vo-primary" onClick={() => void send()} disabled={sending || text.trim() === ''}>{sending ? 'Sending…' : message?.kind === 'error' ? 'Try sending again' : 'Send'}</button>
      <button className="vo-quiet" onClick={() => void skip()} disabled={sending}>I cannot understand this clip. Skip it</button>
      {sentCount > 0 ? <p className="vo-muted vo-count">You have sent {sentCount} {sentCount === 1 ? 'answer' : 'answers'} today. Thank you!</p> : null}
    </section>
  );
}
