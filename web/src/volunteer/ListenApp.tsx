import { useEffect, useMemo, useRef, useState } from 'react';

import { VolunteerApiError, VolunteerClient, type ListenResult } from '../api/volunteer-client';
import { nextSpeed, speedLabel, type Speed } from '../domain/volunteer-view';

/** One clip opened from a link shared in the community: listen again, as many times as needed. */
export function ListenApp({ link, clipId }: { link: string; clipId: string }) {
  const client = useMemo(() => new VolunteerClient(link), [link]);
  const [clip, setClip] = useState<ListenResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const audio = useRef<HTMLAudioElement>(null);
  const refetched = useRef(false);

  const load = async () => {
    try {
      setClip(await client.listen(clipId));
      setProblem(null);
    } catch (cause) {
      setProblem(cause instanceof VolunteerApiError || cause instanceof Error ? cause.message : 'Une erreur est survenue.');
    }
  };
  useEffect(() => { void load(); }, [client, clipId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const element = audio.current;
    if (element) { element.defaultPlaybackRate = speed; element.playbackRate = speed; }
  }, [speed, clip]);

  const toggle = async () => {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) { element.pause(); return; }
    try { element.playbackRate = speed; await element.play(); setProblem(null); } catch {
      setProblem('Le son n’a pas pu être lu. Vérifiez votre connexion et touchez Écouter de nouveau.');
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
    if (refetched.current) { setProblem('Ce son n’a pas pu être chargé. Réessayez dans un instant.'); return; }
    refetched.current = true;
    void load();
  };

  return (
    <div className="vo-shell">
      <header className="vo-header">
        <span className="vo-mark" aria-hidden="true">S</span>
        <strong>SautiForge</strong>
      </header>
      <main className="vo-main">
        {!clip && !problem ? <p className="vo-muted" role="status">Un instant…</p> : null}
        {!clip && problem ? (
          <section className="vo-card">
            <h1>Ce lien ne fonctionne pas</h1>
            <p className="vo-muted">{problem}</p>
          </section>
        ) : null}
        {clip ? (
          <section className="vo-card" aria-labelledby="listen-title">
            <p className="vo-progress-text" id="listen-title">Musingo ! Extrait {clip.position} sur {clip.clipCount}</p>
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
            {problem ? <p className="vo-error" role="alert">{problem}</p> : null}
            <p className="vo-hint">Écoutez autant de fois que vous voulez, puis répondez dans le groupe.</p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
