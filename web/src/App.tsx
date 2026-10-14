import { useEffect, useMemo, useRef, useState } from 'react';

import { audioMimeType, latestTranscription, loadResearchDataset, matchesRecordingQuery, type LoadedResearchDataset, type ResearchRecording } from './domain/dataset';

export function App() {
  const picker = useRef<HTMLInputElement>(null);
  const [dataset, setDataset] = useState<LoadedResearchDataset | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadResearchDataset(file);
      setDataset(loaded);
      setSelectedId(loaded.records.recordings[0]?.id ?? null);
    } catch (cause) {
      setDataset(null);
      setSelectedId(null);
      setError(cause instanceof Error ? cause.message : 'The dataset could not be opened.');
    } finally {
      setLoading(false);
      if (picker.current) picker.current.value = '';
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">S</div>
        <div>
          <p className="eyebrow">SautiForge</p>
          <h1>Dataset annotation</h1>
        </div>
        {dataset ? <button className="secondary header-action" onClick={() => picker.current?.click()}>Open another ZIP</button> : null}
      </header>

      <input ref={picker} hidden type="file" accept=".zip,application/zip" onChange={(event) => void open(event.target.files?.[0])} />

      {!dataset ? (
        <main className="welcome">
          <section className="hero-card">
            <p className="eyebrow">Local browser workflow</p>
            <h2>Open a verified SautiForge research dataset</h2>
            <p>The archive is validated and read on this device. It is not uploaded.</p>
            <button disabled={loading} onClick={() => picker.current?.click()}>{loading ? 'Validating dataset…' : 'Choose research ZIP'}</button>
            {error ? <div className="error" role="alert">{error}</div> : null}
          </section>
          <div className="privacy-note"><span aria-hidden="true">✓</span> Private administrative backups are rejected.</div>
        </main>
      ) : (
        <DatasetWorkspace dataset={dataset} selectedId={selectedId} setSelectedId={setSelectedId} query={query} setQuery={setQuery} />
      )}
    </div>
  );
}

function DatasetWorkspace({ dataset, selectedId, setSelectedId, query, setQuery }: {
  dataset: LoadedResearchDataset;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  query: string;
  setQuery: (value: string) => void;
}) {
  const participants = useMemo(() => new Map(dataset.records.participants.map((item) => [item.id, item])), [dataset]);
  const scenarios = useMemo(() => new Map(dataset.records.scenarios.map((item) => [item.id, item])), [dataset]);
  const filtered = useMemo(() => {
    return dataset.records.recordings.filter((recording) => {
      const speaker = participants.get(recording.participant_id)?.speaker_code ?? '';
      const scenario = scenarios.get(recording.scenario_id)?.title ?? '';
      return matchesRecordingQuery(recording, speaker, scenario, query);
    });
  }, [dataset, participants, query, scenarios]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
  const transcribed = new Set(dataset.records.transcriptions.filter((item) => Boolean(item.verbatim_text)).map((item) => item.recording_id)).size;

  return (
    <main className="workspace">
      <section className="dataset-heading">
        <div>
          <div className="verified">Verified locally</div>
          <h2>{dataset.records.project.title}</h2>
          <p>{dataset.fileName} · {dataset.manifest.sharingCategory?.replaceAll('_', ' ')}</p>
        </div>
        <div className="stats" aria-label="Dataset summary">
          <Stat value={dataset.records.recordings.length} label="Recordings" />
          <Stat value={dataset.records.participants.length} label="Participants" />
          <Stat value={transcribed} label="Transcribed" />
        </div>
      </section>

      <section className="work-grid">
        <aside className="recording-panel">
          <label className="search-label" htmlFor="recording-search">Search recordings</label>
          <input id="recording-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, speaker, scenario or status" />
          <p className="result-count">{filtered.length} result{filtered.length === 1 ? '' : 's'}</p>
          <div className="recording-list">
            {filtered.map((recording) => {
              const speaker = participants.get(recording.participant_id)?.speaker_code ?? 'Unknown speaker';
              const scenario = scenarios.get(recording.scenario_id)?.title ?? 'Unknown scenario';
              return (
                <button key={recording.id} className={`recording-item ${selected?.id === recording.id ? 'selected' : ''}`} onClick={() => setSelectedId(recording.id)}>
                  <span><strong>{recording.display_id}</strong><small>{speaker}</small></span>
                  <span><small>{scenario}</small><Status value={recording.annotation_status} /></span>
                </button>
              );
            })}
            {!filtered.length ? <p className="empty">No recordings match this search.</p> : null}
          </div>
        </aside>
        <section className="detail-panel">
          {selected ? <RecordingDetail key={selected.id} dataset={dataset} recording={selected} /> : <p className="empty">Select a recording.</p>}
        </section>
      </section>
    </main>
  );
}

function RecordingDetail({ dataset, recording }: { dataset: LoadedResearchDataset; recording: ResearchRecording }) {
  const scenario = dataset.records.scenarios.find((item) => item.id === recording.scenario_id);
  const participant = dataset.records.participants.find((item) => item.id === recording.participant_id);
  const transcript = latestTranscription(dataset, recording.id);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    const bytes = dataset.entries.get(recording.audio_path);
    if (!bytes) return;
    const copy = Uint8Array.from(bytes);
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: audioMimeType(recording.audio_path) }));
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [dataset, recording]);

  return (
    <article>
      <div className="detail-title">
        <div><p className="eyebrow">{participant?.speaker_code}</p><h2>{recording.display_id}</h2></div>
        <Status value={recording.annotation_status} />
      </div>
      <div className="context-card">
        <div><span>Scenario</span><strong>{scenario?.title ?? 'Unknown'}</strong></div>
        <div><span>Example</span><strong>{recording.elicitation_prompt_text ?? 'No example recorded'}</strong></div>
      </div>
      {audioUrl ? <audio className="audio-player" controls preload="metadata" src={audioUrl}>Your browser cannot play this audio format.</audio> : null}
      <dl className="metadata-grid">
        <Metadata label="Languages" value={jsonList(recording.spoken_languages_json)} />
        <Metadata label="Variety" value={recording.language_variety ?? 'Unavailable'} />
        <Metadata label="Duration" value={formatDuration(recording.duration_ms)} />
        <Metadata label="Format" value={`${recording.container.toUpperCase()} · ${recording.codec ?? 'codec unavailable'}`} />
      </dl>
      <section className="transcript-card">
        <p className="eyebrow">Latest transcription</p>
        <h3>Verbatim</h3>
        <p>{transcript?.verbatim_text ?? 'Not transcribed yet.'}</p>
        {transcript?.normalized_text ? <><h3>Normalized</h3><p>{transcript.normalized_text}</p></> : null}
      </section>
    </article>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}

function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{value.replaceAll('_', ' ')}</span>;
}

function Metadata({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function jsonList(value: string): string {
  try { return (JSON.parse(value) as string[]).join(', '); }
  catch { return value; }
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
