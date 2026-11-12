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
      else setPhase({ kind: 'invalid', message: cause instanceof Error ? cause.message : 'Ce lien n’est pas valide.' });
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
            <button className="vo-linkbutton" onClick={() => { clearContributor(); void start(); }}>Ce n’est pas vous ?</button>
          </span>
        ) : null}
      </header>
      <main className="vo-main">
        {phase.kind === 'loading' ? <p className="vo-muted" role="status">Un instant…</p> : null}
        {phase.kind === 'invalid' ? <Notice title="Ce lien ne fonctionne pas" message={phase.message} /> : null}
        {phase.kind === 'offline' ? <Notice title="Pas de connexion" message={phase.message} action={{ label: 'Réessayer', run: () => void start() }} /> : null}
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
      setError(cause instanceof Error ? cause.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="vo-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h1>Musingo !</h1>
      <p className="vo-lead">Construisons ensemble : faisons parler l’IA dans notre langue.</p>
      <ol className="vo-steps">
        <li>Écoutez un court extrait.</li>
        <li>Écrivez ce que vous entendez.</li>
        <li>Envoyez. Il y a {info.clipCount} extraits, et vous pouvez vous arrêter à tout moment.</li>
      </ol>
      <label className="vo-field">
        <span>Choisissez un pseudo</span>
        <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" autoCapitalize="words" maxLength={40} aria-describedby="nick-hint" />
      </label>
      <p id="nick-hint" className="vo-hint">Utilisez un pseudo, pas votre vrai nom ni votre numéro de téléphone. Aucun compte n’est nécessaire.</p>
      {error ? <p className="vo-error" role="alert">{error}</p> : null}
      <button className="vo-primary" type="submit" disabled={busy || name.trim().length < 2}>{busy ? 'Un instant…' : 'Commencer'}</button>
    </form>
  );
}

/** Drafts of the optional note live beside the main draft of the same clip. */
const noteKey = (clipId: string) => `${clipId}.note`;

function Listening({ client, me, onSignedOut }: { client: VolunteerClient; me: SavedContributor; onSignedOut: () => void }) {
  const [state, setState] = useState<NextResult | null>(null);
  const [text, setText] = useState('');
  const [correction, setCorrection] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [sentCount, setSentCount] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const refetched = useRef(false);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof VolunteerApiError && cause.status === 401) { onSignedOut(); return; }
    setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : 'Une erreur est survenue.' });
  }, [onSignedOut]);

  const load = useCallback(async () => {
    try {
      const result = await client.next(me.token);
      refetched.current = false;
      setState(result);
      setText(result.clip ? loadDraft(result.clip.clipId) : '');
      setCorrection(result.clip ? loadDraft(noteKey(result.clip.clipId)) : '');
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
      setMessage({ kind: 'error', text: 'Le son n’a pas pu être lu. Vérifiez votre connexion et touchez Écouter de nouveau.' });
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
    if (refetched.current) { setMessage({ kind: 'error', text: 'Ce son n’a pas pu être chargé. Réessayez dans un instant.' }); return; }
    refetched.current = true;
    void load();
  };

  const change = (value: string) => {
    setText(value);
    if (clip) saveDraft(clip.clipId, value);
  };

  const changeCorrection = (value: string) => {
    setCorrection(value);
    if (clip) saveDraft(noteKey(clip.clipId), value);
  };

  const send = async () => {
    if (!clip || text.trim() === '') return;
    setSending(true);
    setMessage(null);
    try {
      await client.submit(me.token, clip.clipId, text, correction);
      clearDraft(clip.clipId);
      clearDraft(noteKey(clip.clipId));
      setSentCount((count) => count + 1);
      setMessage({ kind: 'ok', text: 'Envoyé. Merci !' });
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
      clearDraft(noteKey(clip.clipId));
      await load();
    } catch (cause) {
      fail(cause);
    } finally {
      setSending(false);
    }
  };

  if (!state) return <p className="vo-muted" role="status">{message ? '' : 'Recherche de votre extrait…'}{message ? <span className="vo-error" role="alert">{message.text}</span> : null}</p>;

  if (!clip) {
    return (
      <section className="vo-card vo-done">
        <div className="vo-check" aria-hidden="true">✓</div>
        <h1>Merci, {me.pseudonym} !</h1>
        <p className="vo-muted">
          {state.progress.answered > 0 ? `Vous avez répondu à ${state.progress.answered} extrait${state.progress.answered > 1 ? 's' : ''} sur ${state.progress.total}. ` : ''}
          Il n’y a plus d’extraits pour vous dans ce lot. D’autres arriveront bientôt. Partagez le lien avec quelqu’un qui parle la langue.
        </p>
      </section>
    );
  }

  const percent = progressPercent(state.progress.answered, state.progress.total);

  return (
    <section className="vo-card" aria-labelledby="clip-title">
      <p className="vo-progress-text" id="clip-title">Extrait {Math.min(state.progress.answered + 1, state.progress.total)} sur {state.progress.total}</p>
      <div className="vo-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Votre progression"><span style={{ width: `${percent}%` }} /></div>

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
        {playing ? 'Pause' : 'Écouter'}
      </button>
      <div className="vo-tools">
        <button className="secondary vo-secondary" onClick={() => void again()}>↺ Encore</button>
        <button className="secondary vo-secondary" onClick={() => setSpeed(nextSpeed(speed))}>Vitesse : {speedLabel(speed)}</button>
      </div>

      <label className="vo-field">
        <span>Écrivez exactement ce que vous entendez</span>
        <textarea
          rows={4}
          value={text}
          onChange={(event) => change(event.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          placeholder="Écrivez ici…"
        />
      </label>
      <p className="vo-hint">Écrivez ce que la personne dit vraiment, même si un mot est mal prononcé. Ne le corrigez pas ici : pour l’IA, ce qui est dit compte plus que ce qui est attendu.</p>

      <label className="vo-field">
        <span>Forme correcte, si vous la connaissez <small>(facultatif)</small></span>
        <input
          value={correction}
          onChange={(event) => changeCorrection(event.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          placeholder="Par exemple : âfusire"
        />
      </label>
      <p className="vo-hint">Si le mot entendu n’est pas la bonne forme, écrivez ici celle que vous pensez juste. Votre texte est gardé sur ce téléphone pendant que vous écrivez.</p>

      <div aria-live="polite">
        {message ? <p className={message.kind === 'error' ? 'vo-error' : 'vo-ok'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
      </div>
      <button className="vo-primary" onClick={() => void send()} disabled={sending || text.trim() === ''}>{sending ? 'Envoi…' : message?.kind === 'error' ? 'Réessayer l’envoi' : 'Envoyer'}</button>
      <button className="vo-quiet" onClick={() => void skip()} disabled={sending}>Je ne comprends pas cet extrait. Passer</button>
      {sentCount > 0 ? <p className="vo-muted vo-count">Vous avez envoyé {sentCount} réponse{sentCount > 1 ? 's' : ''}. Merci !</p> : null}
    </section>
  );
}
