import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { currencyOptions, paymentMethodOptions, preserveAnnotationValue, productOrServiceOptions, transactionIntentOptions } from '../../src/features/annotations/domain/business-annotation-options';
import type { BusinessAnnotationPayload } from '../../src/features/annotations/domain/annotation';
import { effectiveAnnotationStatus, firstIncompleteRecording, participantAnnotationProgress, recordingHasVerbatim } from './domain/annotation-workflow';
import { createAnnotatedResearchArchive } from './domain/annotated-export';
import { initialDraft, LocalDraftRepository, prepareDraftForSave, type WebAnnotationDraft } from './domain/draft';
import { audioMimeType, loadResearchDataset, matchesRecordingQuery, type LoadedResearchDataset, type ResearchRecording } from './domain/dataset';
import { IndexedDbWorkspaceArchiveStorage, WorkspaceArchiveRepository } from './domain/workspace-archive';

export function App() {
  const picker = useRef<HTMLInputElement>(null);
  const [dataset, setDataset] = useState<LoadedResearchDataset | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const archiveRepository = useMemo(() => new WorkspaceArchiveRepository(new IndexedDbWorkspaceArchiveStorage()), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    archiveRepository.load()
      .then(async (saved) => {
        if (!saved || cancelled) return;
        const loaded = await loadResearchDataset({
          name: saved.fileName,
          size: saved.bytes.byteLength,
          arrayBuffer: async () => saved.bytes.slice(0),
        });
        if (cancelled) return;
        setDataset(loaded);
        setSelectedId(loaded.records.recordings[0]?.id ?? null);
        setNotice(`Restored the verified local workspace saved on ${new Date(saved.savedAt).toLocaleString()}.`);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The saved workspace could not be opened.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [archiveRepository]);

  const open = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const bytes = await file.arrayBuffer();
      const loaded = await loadResearchDataset({ name: file.name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice(0) });
      setDataset(loaded);
      setSelectedId(loaded.records.recordings[0]?.id ?? null);
      setQuery('');
      try {
        const saved = await archiveRepository.save({ fileName: file.name, bytes, savedAt: new Date().toISOString() });
        setNotice(`Verified and retained this ZIP in the current browser on ${new Date(saved.savedAt).toLocaleString()}.`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The ZIP could not be retained by this browser.');
      }
    } catch (cause) {
      setDataset(null);
      setSelectedId(null);
      setError(cause instanceof Error ? cause.message : 'The dataset could not be opened.');
    } finally {
      setLoading(false);
      if (picker.current) picker.current.value = '';
    }
  };

  const forgetWorkspace = async () => {
    if (!window.confirm('Remove the retained research ZIP and close this workspace? Saved annotation drafts remain in this browser.')) return;
    try {
      await archiveRepository.clear();
      setDataset(null);
      setSelectedId(null);
      setQuery('');
      setNotice(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The saved workspace could not be removed.');
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
        {dataset ? <div className="header-actions"><button className="secondary" onClick={() => picker.current?.click()}>Open another ZIP</button><button className="quiet" onClick={() => void forgetWorkspace()}>Close &amp; forget ZIP</button></div> : null}
      </header>

      <input ref={picker} hidden type="file" accept=".zip,application/zip" onChange={(event) => void open(event.target.files?.[0])} />

      {!dataset ? (
        <main className="welcome">
          <section className="hero-card">
            <p className="eyebrow">Local browser workflow</p>
            <h2>Open a verified SautiForge research dataset</h2>
            <p>The archive is validated and read on this device. It is not uploaded.</p>
            <button disabled={loading} onClick={() => picker.current?.click()}>{loading ? 'Checking saved workspace…' : 'Choose research ZIP'}</button>
            {error ? <div className="error" role="alert">{error}</div> : null}
          </section>
          <div className="privacy-note"><span aria-hidden="true">✓</span> Private administrative backups are rejected.</div>
        </main>
      ) : (
        <><div className="global-messages">{notice ? <div className="save-message" role="status">{notice}</div> : null}{error ? <div className="error" role="alert">{error}</div> : null}</div><DatasetWorkspace key={dataset.manifestSha256} dataset={dataset} selectedId={selectedId} setSelectedId={setSelectedId} query={query} setQuery={setQuery} /></>
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
  const draftRepository = useMemo(() => new LocalDraftRepository(window.localStorage), []);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(
    dataset.records.recordings.find((item) => item.id === selectedId)?.participant_id ?? dataset.records.participants[0]?.id ?? null,
  );
  const [draftVersion, setDraftVersion] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const localDrafts = useMemo(() => {
    try { return draftRepository.listForDataset(dataset); }
    catch { return []; }
  }, [dataset, draftRepository, draftVersion]);
  const draftsByRecording = useMemo(() => new Map(localDrafts.map((draft) => [draft.recordingId, draft])), [localDrafts]);
  const progress = useMemo(() => participantAnnotationProgress(dataset, localDrafts), [dataset, localDrafts]);
  const progressByParticipant = useMemo(() => new Map(progress.map((item) => [item.participantId, item])), [progress]);
  const filtered = useMemo(() => {
    return dataset.records.recordings.filter((recording) => {
      if (recording.participant_id !== selectedParticipantId) return false;
      const speaker = participants.get(recording.participant_id)?.speaker_code ?? '';
      const scenario = scenarios.get(recording.scenario_id)?.title ?? '';
      const annotationStatus = effectiveAnnotationStatus(recording, draftsByRecording.get(recording.id));
      return matchesRecordingQuery({ ...recording, annotation_status: annotationStatus }, speaker, scenario, query);
    });
  }, [dataset, draftsByRecording, participants, query, scenarios, selectedParticipantId]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
  const transcribed = progress.reduce((total, item) => total + item.transcribedCount, 0);

  const selectParticipant = (participantId: string) => {
    setSelectedParticipantId(participantId);
    const next = firstIncompleteRecording(dataset, participantId, localDrafts);
    if (next) setSelectedId(next.id);
    setQuery('');
  };

  const continueAfterSave = (recording: ResearchRecording) => {
    const drafts = draftRepository.listForDataset(dataset);
    setDraftVersion((value) => value + 1);
    const sameSpeaker = dataset.records.recordings.filter((item) => item.participant_id === recording.participant_id);
    const currentIndex = sameSpeaker.findIndex((item) => item.id === recording.id);
    const orderedRecordings = [...sameSpeaker.slice(currentIndex + 1), ...sameSpeaker.slice(0, currentIndex)];
    const nextSameSpeaker = orderedRecordings.find((item) => !recordingHasVerbatim(dataset, item, drafts));
    if (nextSameSpeaker) {
      setSelectedId(nextSameSpeaker.id);
      return true;
    }

    const participantIndex = dataset.records.participants.findIndex((item) => item.id === recording.participant_id);
    const orderedParticipants = [...dataset.records.participants.slice(participantIndex + 1), ...dataset.records.participants.slice(0, participantIndex)];
    const updatedProgress = participantAnnotationProgress(dataset, drafts);
    const nextParticipant = orderedParticipants.find((item) => {
      const state = updatedProgress.find((entry) => entry.participantId === item.id);
      return state && state.recordingCount > 0 && !state.complete;
    });
    if (!nextParticipant) return false;
    setSelectedParticipantId(nextParticipant.id);
    const nextRecording = firstIncompleteRecording(dataset, nextParticipant.id, drafts);
    if (nextRecording) setSelectedId(nextRecording.id);
    return Boolean(nextRecording);
  };

  const exportAnnotated = async () => {
    setExporting(true);
    setExportMessage(null);
    setExportError(null);
    try {
      const drafts = draftRepository.listForDataset(dataset);
      const output = await createAnnotatedResearchArchive(dataset, drafts);
      const copy = Uint8Array.from(output.bytes);
      const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = output.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setExportMessage(`Verified ${output.fileName} and sent it to browser downloads with ${output.appliedDrafts} local draft${output.appliedDrafts === 1 ? '' : 's'}. Archive SHA-256: ${output.archiveSha256}`);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : 'The annotated dataset could not be exported.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="workspace">
      <section className="dataset-heading">
        <div>
          <div className="verified">Verified locally</div>
          <h2>{dataset.records.project.title}</h2>
          <p>{dataset.fileName} · {dataset.manifest.sharingCategory?.replaceAll('_', ' ')}</p>
        </div>
        <div className="summary-actions">
          <div className="stats" aria-label="Dataset summary">
            <Stat value={dataset.records.recordings.length} label="Recordings" />
            <Stat value={dataset.records.participants.length} label="Participants" />
            <Stat value={transcribed} label="Transcribed" />
            <Stat value={localDrafts.length} label="Local drafts" />
          </div>
          <button disabled={exporting} onClick={() => void exportAnnotated()}>{exporting ? 'Building and verifying…' : 'Download annotated ZIP'}</button>
        </div>
      </section>
      {exportError ? <div className="error workspace-message" role="alert">{exportError}</div> : null}
      {exportMessage ? <div className="save-message workspace-message" role="status">{exportMessage}</div> : null}

      <section className="work-grid">
        <aside className="recording-panel">
          <p className="panel-heading">Speakers</p>
          <div className="participant-list">
            {dataset.records.participants.map((participant) => {
              const state = progressByParticipant.get(participant.id);
              return <button key={participant.id} className={`participant-item ${participant.id === selectedParticipantId ? 'selected' : ''} ${state?.complete ? 'complete' : ''}`} onClick={() => selectParticipant(participant.id)}>
                <span><strong>{participant.speaker_code}</strong><small>{state?.transcribedCount ?? 0}/{state?.recordingCount ?? 0} transcribed</small></span>
                <span>{state?.complete ? 'Done' : 'In progress'}</span>
              </button>;
            })}
          </div>
          <label className="search-label" htmlFor="recording-search">Search this speaker’s recordings</label>
          <input id="recording-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, speaker, scenario or status" />
          <p className="result-count">{filtered.length} recording{filtered.length === 1 ? '' : 's'} for this speaker</p>
          <div className="recording-list">
            {filtered.map((recording) => {
              const speaker = participants.get(recording.participant_id)?.speaker_code ?? 'Unknown speaker';
              const scenario = scenarios.get(recording.scenario_id)?.title ?? 'Unknown scenario';
              const annotationStatus = effectiveAnnotationStatus(recording, draftsByRecording.get(recording.id));
              return (
                <button key={recording.id} className={`recording-item ${selected?.id === recording.id ? 'selected' : ''}`} onClick={() => setSelectedId(recording.id)}>
                  <span><strong>{recording.display_id}</strong><small>{speaker}</small></span>
                  <span><small>{scenario}</small><Status value={annotationStatus} /></span>
                </button>
              );
            })}
            {!filtered.length ? <p className="empty">No recordings match this search.</p> : null}
          </div>
        </aside>
        <section className="detail-panel">
          {selected ? <RecordingDetail key={selected.id} dataset={dataset} recording={selected} onDraftChange={() => setDraftVersion((value) => value + 1)} onSaveAndContinue={continueAfterSave} /> : <p className="empty">Select a recording.</p>}
        </section>
      </section>
    </main>
  );
}

function RecordingDetail({ dataset, recording, onDraftChange, onSaveAndContinue }: { dataset: LoadedResearchDataset; recording: ResearchRecording; onDraftChange: () => void; onSaveAndContinue: (recording: ResearchRecording) => boolean }) {
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

  const saveDraft = (shouldContinue: boolean) => {
    if (shouldContinue && !draft.verbatimText.trim()) {
      setDraftMessage(null);
      setDraftError('Add the verbatim transcription before continuing. Use “Save draft and stay” for incomplete work.');
      return;
    }
    try {
      const saved = repository.save(prepareDraftForSave(draft));
      setDraft(saved);
      setDraftMessage(shouldContinue ? null : `Draft saved and verified in this browser at ${new Date(saved.updatedAt).toLocaleString()}. You can continue editing this recording.`);
      setDraftError(null);
      if (shouldContinue) {
        const moved = onSaveAndContinue(recording);
        if (!moved) setDraftMessage('Draft saved and verified. Every speaker with recordings now has a verbatim transcription.');
      } else onDraftChange();
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
      onDraftChange();
    } catch (cause) {
      setDraftError(cause instanceof Error ? cause.message : 'The local draft could not be removed.');
    }
  };

  return (
    <article>
      <div className="detail-title">
        <div><p className="eyebrow">{participant?.speaker_code}</p><h2>{recording.display_id}</h2></div>
        <Status value={draft.annotationStatus} />
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
      <form className="annotation-editor" onSubmit={(event) => { event.preventDefault(); saveDraft(true); }}>
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
          <Field label="Product or service" hint="Choose a canonical suggestion or type a new English snake_case value when none matches. Keep the speaker’s original word in the verbatim transcript.">
            <SuggestionInput id="product-or-service-options" value={draft.businessLabels.productOrService ?? ''} options={productOrServiceOptions} onChange={(value) => updateBusiness('productOrService', value)} />
          </Field>
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
          <button type="submit">Save &amp; continue</button>
          <button className="secondary" type="button" onClick={() => saveDraft(false)}>Save draft and stay</button>
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

function SuggestionInput({ id, value, options, onChange }: { id: string; value: string; options: { label: string; value: string }[]; onChange: (value: string) => void }) {
  return <><input list={id} value={value} placeholder="Select or type a value" onChange={(event) => onChange(event.target.value)} /><datalist id={id}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist></>;
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
