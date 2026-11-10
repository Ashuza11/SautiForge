import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { Source } from '../../server/src/sources/source';
import { AdminGate, API_BASE_URL } from './AdminGate';
import { ApiClient, ApiError, type ApiProject, type ApiSourceDetail } from './api/client';
import {
  blankRightsForm,
  blankSourceForm,
  buildRightsDraft,
  buildSourceDraft,
  decisionLabels,
  languageLabels,
  publishCommand,
  sourceTypeLabels,
  statusLabels,
  usageLabels,
  type RightsForm,
  type SourceForm,
} from './domain/sources-view';

export function SourcesAdmin() {
  return (
    <AdminGate purpose="manage sources">
      {({ client, onSignedOut }) => <SourcesEditor client={client} onSignedOut={onSignedOut} />}
    </AdminGate>
  );
}

function SourcesEditor({ client, onSignedOut }: { client: ApiClient; onSignedOut: () => void }) {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<SourceForm>(blankSourceForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((cause: unknown, fallback: string) => {
    if (cause instanceof ApiError && cause.status === 401) { onSignedOut(); return; }
    setError(cause instanceof Error ? cause.message : fallback);
  }, [onSignedOut]);

  useEffect(() => {
    client.projects().then((list) => {
      setProjects(list);
      setProjectId((current) => current || list.find((project) => project.languageCode === 'shr')?.id || list[0]?.id || '');
    }, (cause) => fail(cause, 'Projects could not be loaded.'));
  }, [client, fail]);

  const reload = useCallback(async () => {
    if (!projectId) return;
    try { setSources(await client.sourceList(projectId)); } catch (cause) { fail(cause, 'Sources could not be loaded.'); }
  }, [client, projectId, fail]);
  useEffect(() => { void reload(); }, [reload]);

  const set = (key: keyof SourceForm) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const create = async () => {
    setError(null);
    setMessage(null);
    const built = buildSourceDraft(form);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    setBusy(true);
    try {
      const source = await client.createSource(projectId, built.value);
      setForm(blankSourceForm);
      setOpenId(source.id);
      setMessage(`Added “${source.title}”. Now record the permission decision below.`);
      await reload();
    } catch (cause) {
      fail(cause, 'The source could not be added.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="project-admin">
      <section className="dataset-heading">
        <div>
          <p className="eyebrow">Web administration</p>
          <h2>Sources</h2>
          <p>A source is the original recording that clips are cut from. Record where it came from and what permission you have.</p>
        </div>
      </section>

      <section className="project-admin-grid">
        <div className="project-list-card">
          <label className="clips-field">Project
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.length === 0 ? <option value="">Create a project first</option> : null}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
          <h3>Registered sources</h3>
          {sources.length === 0 ? <p className="empty">No source yet for this project.</p> : sources.map((source) => (
            <article className="web-project-card" key={source.id}>
              <div><strong>{source.title}</strong><small>{statusLabels[source.status]}</small></div>
              <div className="compact-actions">
                <button className="secondary" onClick={() => setOpenId(openId === source.id ? null : source.id)}>{openId === source.id ? 'Close' : 'Permission and id'}</button>
              </div>
              {openId === source.id ? <SourceRights client={client} source={source} onChanged={reload} fail={fail} /> : null}
            </article>
          ))}
        </div>

        <form className="annotation-editor project-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <div className="editor-heading"><div><p className="eyebrow">New source</p><h3>Add a recording</h3></div></div>
          <Field label="Where does it come from?" error={errors.sourceType}>
            <select value={form.sourceType} onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value as SourceForm['sourceType'] }))}>
              {Object.entries(sourceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Title" error={errors.title}><input value={form.title} onChange={(event) => set('title')(event.target.value)} /></Field>
          <Field label="Link to the recording (https)" error={errors.originalUrl}><input value={form.originalUrl} placeholder="https://" onChange={(event) => set('originalUrl')(event.target.value)} /></Field>
          <div className="form-grid">
            <Field label="Creator or owner" error={errors.creator}><input value={form.creator} onChange={(event) => set('creator')(event.target.value)} /></Field>
            <Field label="Length in minutes" error={errors.durationMs}><input inputMode="decimal" value={form.durationMinutes} placeholder="For example 6.7" onChange={(event) => set('durationMinutes')(event.target.value)} /></Field>
            <Field label="Is it in the project language?" error={errors.languageVerification}>
              <select value={form.languageVerification} onChange={(event) => setForm((current) => ({ ...current, languageVerification: event.target.value as SourceForm['languageVerification'] }))}>
                {Object.entries(languageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Checked by (code, not a name)" error={errors.languageVerifiedBy}><input value={form.languageVerifiedBy} placeholder="ADMIN-01" onChange={(event) => set('languageVerifiedBy')(event.target.value)} /></Field>
          </div>
          <Field label="Notes about the language" error={errors.languageVerificationNotes}><textarea rows={2} value={form.languageVerificationNotes} onChange={(event) => set('languageVerificationNotes')(event.target.value)} /></Field>
          {error ? <div className="error" role="alert">{error}</div> : null}
          {message ? <div className="save-message" role="status">{message}</div> : null}
          <div className="editor-actions"><button type="submit" disabled={busy || !projectId}>{busy ? 'Adding…' : 'Add source'}</button></div>
        </form>
      </section>
    </main>
  );
}

function SourceRights({ client, source, onChanged, fail }: {
  client: ApiClient;
  source: Source;
  onChanged: () => Promise<void>;
  fail: (cause: unknown, fallback: string) => void;
}) {
  const [detail, setDetail] = useState<ApiSourceDetail | null>(null);
  const [form, setForm] = useState<RightsForm>(blankRightsForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { setDetail(await client.sourceDetail(source.id)); } catch (cause) { fail(cause, 'The source could not be opened.'); }
  }, [client, source.id, fail]);
  useEffect(() => { void load(); }, [load]);

  const set = (key: keyof RightsForm) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setNotice(null);
    const built = buildRightsDraft(form);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    setBusy(true);
    try {
      await client.addRights(source.id, built.value);
      setForm(blankRightsForm);
      setNotice('Permission decision saved.');
      await Promise.all([load(), onChanged()]);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status !== 401) setErrors({ form: cause.message }); else fail(cause, 'The decision could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const command = publishCommand(source.id, window.location.origin || API_BASE_URL);
  const latest = detail?.latestRights ?? null;

  return (
    <div className="rights-panel">
      <p className="clips-muted">Source id (needed by the publish command)</p>
      <code className="source-id">{source.id}</code>
      <div className="compact-actions">
        <button className="secondary" type="button" onClick={() => { void navigator.clipboard?.writeText(command).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy publish command'}</button>
      </div>
      <p className="clips-muted">
        {latest
          ? `Current decision: ${decisionLabels[latest.decision]} (decision no. ${latest.revision}). Every change is kept as a new record.`
          : 'No decision recorded yet. Clips cannot be published until permission is given.'}
      </p>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="form-grid">
          <Field label="Who owns the rights?" error={errors.rightsHolder}><input value={form.rightsHolder} onChange={(event) => set('rightsHolder')(event.target.value)} /></Field>
          <Field label="Licence or terms (optional)" error={errors.license}><input value={form.license} onChange={(event) => set('license')(event.target.value)} /></Field>
        </div>
        <Field label="Evidence of permission (a note, a link, who agreed and when)" error={errors.permissionEvidence}><textarea rows={2} value={form.permissionEvidence} onChange={(event) => set('permissionEvidence')(event.target.value)} /></Field>
        <Field label="How must the owner be credited? (optional)" error={errors.attributionRequirements}><input value={form.attributionRequirements} onChange={(event) => set('attributionRequirements')(event.target.value)} /></Field>
        <fieldset className="uses">
          <legend>What is allowed?</legend>
          {(Object.keys(usageLabels) as (keyof RightsForm['authorizedUses'])[]).map((key) => (
            <label key={key} className="check">
              <input type="checkbox" checked={form.authorizedUses[key]} onChange={(event) => setForm((current) => ({ ...current, authorizedUses: { ...current.authorizedUses, [key]: event.target.checked } }))} />
              {usageLabels[key]}
            </label>
          ))}
          {errors.authorizedUses ? <small className="field-error">{errors.authorizedUses}</small> : null}
        </fieldset>
        <div className="form-grid">
          <Field label="Decision" error={errors.decision}>
            <select value={form.decision} onChange={(event) => setForm((current) => ({ ...current, decision: event.target.value as RightsForm['decision'] }))}>
              {Object.entries(decisionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Recorded by (code, not a name)" error={errors.changedBy}><input value={form.changedBy} placeholder="ADMIN-01" onChange={(event) => set('changedBy')(event.target.value)} /></Field>
        </div>
        <Field label="Why this decision?" error={errors.changeReason}><input value={form.changeReason} onChange={(event) => set('changeReason')(event.target.value)} /></Field>
        {errors.form ? <div className="error" role="alert">{errors.form}</div> : null}
        {notice ? <div className="save-message" role="status">{notice}</div> : null}
        <div className="editor-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save decision'}</button></div>
      </form>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{error ? <small className="field-error">{error}</small> : null}</label>;
}
