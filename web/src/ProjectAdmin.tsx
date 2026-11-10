import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { projectDraftSchema, type Project, type ProjectDraft } from '../../src/features/projects/domain/project';
import { AdminGate } from './AdminGate';
import { ApiClient, ApiError } from './api/client';
import { serializeProjectTemplate } from './domain/project-workspace';

const blankProject: ProjectDraft = {
  title: '',
  description: '',
  targetLanguage: '',
  languageCode: 'und',
  languageVariety: '',
  researchDomain: '',
  collectionLocation: '',
  protocolVersion: '0.1',
  annotationProfile: 'verbatim_transcription',
  status: 'active',
};

export function ProjectAdmin({ onClose }: { onClose: () => void }) {
  return (
    <AdminGate purpose="manage projects">
      {({ client, onSignedOut }) => <ProjectEditor client={client} onSignedOut={onSignedOut} onClose={onClose} />}
    </AdminGate>
  );
}

function ProjectEditor({ client, onSignedOut, onClose }: { client: ApiClient; onSignedOut: () => void; onClose: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft>(blankProject);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((cause: unknown, fallback: string) => {
    if (cause instanceof ApiError && cause.status === 401) { onSignedOut(); return; }
    setError(cause instanceof Error ? cause.message : fallback);
  }, [onSignedOut]);

  const reload = useCallback(async () => {
    try { setProjects(await client.projectList()); } catch (cause) { fail(cause, 'Projects could not be loaded.'); } finally { setLoading(false); }
  }, [client, fail]);
  useEffect(() => { void reload(); }, [reload]);

  const set = (key: keyof ProjectDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setError(null);
    setMessage(null);
    const parsed = projectDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setBusy(true);
    try {
      const saved = editingId ? await client.updateProject(editingId, parsed.data) : await client.createProject(parsed.data);
      await reload();
      setDraft(blankProject);
      setEditingId(null);
      setErrors({});
      setMessage(`Saved “${saved.title}” to the service.`);
    } catch (cause) {
      fail(cause, 'The project could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const edit = (project: Project) => {
    setEditingId(project.id);
    setDraft({
      title: project.title,
      description: project.description,
      targetLanguage: project.targetLanguage,
      languageCode: project.languageCode,
      languageVariety: project.languageVariety,
      researchDomain: project.researchDomain,
      collectionLocation: project.collectionLocation,
      protocolVersion: project.protocolVersion,
      annotationProfile: project.annotationProfile,
      status: project.status,
    });
    setMessage(null);
    setError(null);
  };

  const archive = async (project: Project) => {
    if (!window.confirm(`Archive “${project.title}”?`)) return;
    setBusy(true);
    try {
      await client.archiveProject(project.id);
      await reload();
      if (editingId === project.id) { setEditingId(null); setDraft(blankProject); }
      setMessage(`Archived “${project.title}”.`);
      setError(null);
    } catch (cause) {
      fail(cause, 'The project could not be archived.');
    } finally {
      setBusy(false);
    }
  };

  const download = (project: Project) => {
    const blob = new Blob([serializeProjectTemplate(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sautiforge-project-${safeName(project.title)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <main className="project-admin">
      <section className="dataset-heading">
        <div><p className="eyebrow">Web administration</p><h2>Research projects</h2><p>Create any language project without changing application code.</p></div>
        <button className="secondary" onClick={onClose}>Back to annotation</button>
      </section>

      <section className="project-admin-grid">
        <div className="project-list-card">
          <h3>Configured projects</h3>
          {loading ? <p className="empty">Loading projects…</p> : projects.length ? projects.map((project) => (
            <article className="web-project-card" key={project.id}>
              <div><strong>{project.title}</strong><small>{project.targetLanguage} · {project.languageVariety} · {project.languageCode}</small></div>
              <p>{project.annotationProfile === 'business_transaction' ? 'Business transaction labels' : 'General verbatim transcription'}</p>
              <div className="compact-actions">
                <button className="secondary" disabled={busy} onClick={() => edit(project)}>Edit</button>
                <button className="secondary" onClick={() => download(project)}>Download configuration</button>
                <button className="quiet" disabled={busy} onClick={() => void archive(project)}>Archive</button>
              </div>
            </article>
          )) : <p className="empty">No project has been created yet.</p>}
        </div>

        <form className="annotation-editor project-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="editor-heading"><div><p className="eyebrow">{editingId ? 'Edit configuration' : 'New configuration'}</p><h3>{editingId ? 'Edit project' : 'Create project'}</h3></div></div>
          <p className="editor-note">Projects are saved to the SautiForge service, so clips and batches can use them.</p>
          <ProjectField label="Project title" error={errors.title}><input value={draft.title} onChange={(event) => set('title')(event.target.value)} /></ProjectField>
          <ProjectField label="Description" error={errors.description}><textarea rows={3} value={draft.description} onChange={(event) => set('description')(event.target.value)} /></ProjectField>
          <div className="form-grid">
            <ProjectField label="Target language" error={errors.targetLanguage}><input value={draft.targetLanguage} placeholder="For example: Shi" onChange={(event) => set('targetLanguage')(event.target.value)} /></ProjectField>
            <ProjectField label="ISO 639-3 code" error={errors.languageCode}><input maxLength={3} value={draft.languageCode} placeholder="shr" onChange={(event) => set('languageCode')(event.target.value.toLowerCase())} /></ProjectField>
            <ProjectField label="Language variety" error={errors.languageVariety}><input value={draft.languageVariety} placeholder="For example: Mashi" onChange={(event) => set('languageVariety')(event.target.value)} /></ProjectField>
            <ProjectField label="Research domain" error={errors.researchDomain}><input value={draft.researchDomain} onChange={(event) => set('researchDomain')(event.target.value)} /></ProjectField>
            <ProjectField label="Collection location" error={errors.collectionLocation}><input value={draft.collectionLocation} onChange={(event) => set('collectionLocation')(event.target.value)} /></ProjectField>
            <ProjectField label="Protocol version" error={errors.protocolVersion}><input value={draft.protocolVersion} onChange={(event) => set('protocolVersion')(event.target.value)} /></ProjectField>
            <ProjectField label="Annotation workflow" error={errors.annotationProfile}>
              <select value={draft.annotationProfile} onChange={(event) => setDraft((current) => ({ ...current, annotationProfile: event.target.value as ProjectDraft['annotationProfile'] }))}>
                <option value="verbatim_transcription">General verbatim transcription</option>
                <option value="business_transaction">Business transaction labels</option>
              </select>
            </ProjectField>
          </div>
          {error ? <div className="error" role="alert">{error}</div> : null}
          {message ? <div className="save-message" role="status">{message}</div> : null}
          <div className="editor-actions">
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Create project'}</button>
            {editingId ? <button className="secondary" type="button" onClick={() => { setEditingId(null); setDraft(blankProject); setErrors({}); }}>Cancel edit</button> : null}
          </div>
        </form>
      </section>
    </main>
  );
}

function ProjectField({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{error ? <small className="field-error">{error}</small> : null}</label>;
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
}
