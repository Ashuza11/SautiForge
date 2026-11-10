import { useState } from 'react';

import type { Project } from '../../../src/features/projects/domain/project';
import type { Source } from '../../../server/src/sources/source';
import { ApiClient, ApiError } from '../api/client';
import {
  buildPermission,
  buildProject,
  buildSource,
  PERMISSION_TEXT,
  type LanguageChoice,
  type ProjectAnswers,
  type SourceAnswers,
} from '../domain/setup';

type Props = {
  client: ApiClient;
  existingProject: Project | null;
  onDone: (project: Project, source: Source) => void;
  onSignedOut: () => void;
};

export function Setup({ client, existingProject, onDone, onSignedOut }: Props) {
  const [project, setProject] = useState<Project | null>(existingProject);
  const [projectAnswers, setProjectAnswers] = useState<ProjectAnswers>({ name: 'Mashi speech corpus', language: 'mashi', otherLanguage: '', otherCode: '' });
  const [sourceAnswers, setSourceAnswers] = useState<SourceAnswers>({ title: '', link: '', permissionConfirmed: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const fail = (cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) { onSignedOut(); return; }
    setFailure(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
  };

  const createProject = async () => {
    setFailure(null);
    const built = buildProject(projectAnswers);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    setBusy(true);
    try { setProject(await client.createProject(built.value)); } catch (cause) { fail(cause); } finally { setBusy(false); }
  };

  const createSource = async () => {
    if (!project) return;
    setFailure(null);
    const built = buildSource(sourceAnswers);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    setBusy(true);
    try {
      const source = await client.createSource(project.id, built.value);
      await client.addRights(source.id, buildPermission(new Date()));
      onDone(project, source);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const step = project ? 2 : 1;

  return (
    <main className="ad-center">
      <div className="ad-card ad-setup">
        <div className="ad-brand"><span className="ad-mark">S</span><span>SautiForge</span></div>
        <p className="ad-step" aria-live="polite">Step {step} of 2</p>

        {step === 1 ? (
          <form onSubmit={(event) => { event.preventDefault(); void createProject(); }}>
            <h1>Start your project</h1>
            <p className="ad-muted">Two quick questions. You can change anything later.</p>
            <label className="ad-field">
              <span>Project name</span>
              <input value={projectAnswers.name} onChange={(event) => setProjectAnswers({ ...projectAnswers, name: event.target.value })} />
              {errors.name ? <small className="ad-error-text">{errors.name}</small> : null}
            </label>
            <label className="ad-field">
              <span>Language</span>
              <select value={projectAnswers.language} onChange={(event) => setProjectAnswers({ ...projectAnswers, language: event.target.value as LanguageChoice })}>
                <option value="mashi">Mashi (Shi)</option>
                <option value="other">Another language…</option>
              </select>
            </label>
            {projectAnswers.language === 'other' ? (
              <div className="ad-row">
                <label className="ad-field">
                  <span>Language name</span>
                  <input value={projectAnswers.otherLanguage} onChange={(event) => setProjectAnswers({ ...projectAnswers, otherLanguage: event.target.value })} />
                  {errors.otherLanguage ? <small className="ad-error-text">{errors.otherLanguage}</small> : null}
                </label>
                <label className="ad-field ad-narrow">
                  <span>Code</span>
                  <input maxLength={3} placeholder="shr" value={projectAnswers.otherCode} onChange={(event) => setProjectAnswers({ ...projectAnswers, otherCode: event.target.value.toLowerCase() })} />
                  {errors.otherCode ? <small className="ad-error-text">{errors.otherCode}</small> : null}
                </label>
              </div>
            ) : null}
            {failure ? <p className="ad-error" role="alert">{failure}</p> : null}
            <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Continue'}</button>
          </form>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void createSource(); }}>
            <h1>Where is the audio from?</h1>
            <p className="ad-muted">This is the recording your clips were cut from.</p>
            <label className="ad-field">
              <span>Name of the recording</span>
              <input value={sourceAnswers.title} placeholder="For example: the film, or the person who recorded it" onChange={(event) => setSourceAnswers({ ...sourceAnswers, title: event.target.value })} autoFocus />
              {errors.title ? <small className="ad-error-text">{errors.title}</small> : null}
            </label>
            <label className="ad-field">
              <span>Link <em>(optional)</em></span>
              <input value={sourceAnswers.link} placeholder="https://" inputMode="url" onChange={(event) => setSourceAnswers({ ...sourceAnswers, link: event.target.value })} />
              {errors.link ? <small className="ad-error-text">{errors.link}</small> : null}
            </label>
            <label className="ad-check">
              <input type="checkbox" checked={sourceAnswers.permissionConfirmed} onChange={(event) => setSourceAnswers({ ...sourceAnswers, permissionConfirmed: event.target.checked })} />
              <span>{PERMISSION_TEXT}</span>
            </label>
            {errors.permissionConfirmed ? <small className="ad-error-text">{errors.permissionConfirmed}</small> : null}
            <p className="ad-hint">If the recording belongs to someone else, get their permission first. Your tick is saved as your own statement, with today's date.</p>
            {failure ? <p className="ad-error" role="alert">{failure}</p> : null}
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Finish setup'}</button>
          </form>
        )}
      </div>
    </main>
  );
}
