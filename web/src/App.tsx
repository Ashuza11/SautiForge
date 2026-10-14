import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { currencyOptions, paymentMethodOptions, preserveAnnotationValue, transactionIntentOptions } from '../../src/features/annotations/domain/business-annotation-options';
import type { BusinessAnnotationPayload } from '../../src/features/annotations/domain/annotation';
import { initialDraft, LocalDraftRepository, type WebAnnotationDraft } from './domain/draft';
import { audioMimeType, loadResearchDataset, matchesRecordingQuery, type LoadedResearchDataset, type ResearchRecording } from './domain/dataset';

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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const repository = useMemo(() => new LocalDraftRepository(window.localStorage), []);
  const baseDraft = useMemo(() => initialDraft(dataset, recording), [dataset, recording]);
  const [draft, setDraft] = useState<WebAnnotationDraft>(baseDraft);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    const bytes = dataset.entries.get(recording.audio_path);
    if (!bytes) return;
    const copy = Uint8Array.from(bytes);
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: audioMimeType(recording.audio_path) }));
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [dataset, recording]);

  useEffect(() => {
    try {
      setDraft(repository.load(dataset.manifestSha256, recording.id) ?? baseDraft);
    } catch (cause) {
      setDraftError(cause instanceof Error ? cause.message : 'The local draft could not be opened.');
    }
  }, [baseDraft, dataset.manifestSha256, recording.id, repository]);

  const updateDraft = (changes: Partial<WebAnnotationDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setDraftMessage(null);
    setDraftError(null);
  };

  const updateBusiness = (field: keyof BusinessAnnotationPayload, value: string) => {
    updateDraft({ businessLabels: { ...draft.businessLabels, [field]: value.trim() || null } });
  };

  const saveDraft = (event: FormEvent) => {
    event.preventDefault();
    try {
      const saved = repository.save({ ...draft, updatedAt: new Date().toISOString() });
      setDraft(saved);
      setDraftMessage(`Saved in this browser at ${new Date(saved.updatedAt).toLocaleString()}.`);
      setDraftError(null);
    } catch (cause) {
      setDraftMessage(null);
      setDraftError(cause instanceof Error ? cause.message : 'The draft could not be saved.');
    }
  };

  const clearDraft = () => {
    if (!window.confirm('Remove the locally saved draft for this recording? The source ZIP will not be changed.')) return;
    try {
      repository.clear(dataset.manifestSha256, recording.id);
      setDraft(initialDraft(dataset, recording));
      setDraftMessage('Local draft removed. The values shown now come from the source ZIP.');
      setDraftError(null);
    } catch (cause) {
      setDraftError(cause instanceof Error ? cause.message : 'The local draft could not be removed.');
    }
  };

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
      <form className="annotation-editor" onSubmit={saveDraft}>
        <div className="editor-heading">
          <div><p className="eyebrow">Human annotation draft</p><h3>Transcription and labels</h3></div>
          <span className="local-badge">This browser only</span>
        </div>
        <p className="editor-note">Drafts are verified after writing to this browser. They are not yet inside the source ZIP; keep that archive unchanged.</p>
        <Field label="Verbatim transcription" hint="Write exactly what was spoken, including Kingwana and French code-switching.">
          <textarea rows={5} value={draft.verbatimText} onChange={(event) => updateDraft({ verbatimText: event.target.value })} />
        </Field>
        <div className="form-grid">
          <Field label="Normalized text" hint="Optional; do not replace the verbatim text.">
            <textarea rows={3} value={draft.normalizedText} onChange={(event) => updateDraft({ normalizedText: event.target.value })} />
          </Field>
          <Field label="Annotation notes">
            <textarea rows={3} value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} />
          </Field>
          <Field label="Scenario context">
            <input value={draft.scenarioContext} onChange={(event) => updateDraft({ scenarioContext: event.target.value })} />
          </Field>
          <Field label="Example context">
            <textarea rows={2} value={draft.elicitationPromptContext} onChange={(event) => updateDraft({ elicitationPromptContext: event.target.value })} />
          </Field>
          <Field label="Language tags" hint="Comma-separated, for example Kingwana, French.">
            <input value={draft.languageTags.join(', ')} onChange={(event) => updateDraft({ languageTags: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Researcher code">
            <input value={draft.createdBy} onChange={(event) => updateDraft({ createdBy: event.target.value })} />
          </Field>
          <Field label="Workflow status">
            <select value={draft.annotationStatus} onChange={(event) => updateDraft({ annotationStatus: event.target.value as WebAnnotationDraft['annotationStatus'] })}>
              {['recorded', 'needs_transcription', 'transcribed', 'needs_review', 'validated', 'rejected'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
          </Field>
        </div>
        <h4>Structured business labels</h4>
        <div className="form-grid form-grid-three">
          <Field label="Transaction intent"><OptionSelect value={draft.businessLabels.transactionIntent} options={preserveAnnotationValue(transactionIntentOptions, draft.businessLabels.transactionIntent)} onChange={(value) => updateBusiness('transactionIntent', value)} /></Field>
          <Field label="Product or service"><input value={draft.businessLabels.productOrService ?? ''} onChange={(event) => updateBusiness('productOrService', event.target.value)} /></Field>
          <Field label="Quantity"><input value={draft.businessLabels.quantity ?? ''} onChange={(event) => updateBusiness('quantity', event.target.value)} /></Field>
          <Field label="Amount"><input value={draft.businessLabels.amount ?? ''} onChange={(event) => updateBusiness('amount', event.target.value)} /></Field>
          <Field label="Currency"><OptionSelect value={draft.businessLabels.currency} options={preserveAnnotationValue(currencyOptions, draft.businessLabels.currency)} onChange={(value) => updateBusiness('currency', value)} /></Field>
          <Field label="Amount paid"><input value={draft.businessLabels.amountPaid ?? ''} onChange={(event) => updateBusiness('amountPaid', event.target.value)} /></Field>
          <Field label="Outstanding debt"><input value={draft.businessLabels.outstandingDebt ?? ''} onChange={(event) => updateBusiness('outstandingDebt', event.target.value)} /></Field>
          <Field label="Payment method"><OptionSelect value={draft.businessLabels.paymentMethod} options={preserveAnnotationValue(paymentMethodOptions, draft.businessLabels.paymentMethod)} onChange={(value) => updateBusiness('paymentMethod', value)} /></Field>
          <Field label="Transaction reference"><input value={draft.businessLabels.transactionReference ?? ''} onChange={(event) => updateBusiness('transactionReference', event.target.value)} /></Field>
        </div>
        {draftError ? <div className="error" role="alert">{draftError}</div> : null}
        {draftMessage ? <div className="save-message" role="status">{draftMessage}</div> : null}
        <div className="editor-actions">
          <button type="submit">Save local draft</button>
          <button className="secondary" type="button" onClick={clearDraft}>Clear local draft</button>
        </div>
      </form>
    </article>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function OptionSelect({ value, options, onChange }: { value: string | null; options: { label: string; value: string }[]; onChange: (value: string) => void }) {
  return <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
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
