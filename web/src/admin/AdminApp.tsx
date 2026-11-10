import { useCallback, useEffect, useState } from 'react';

import type { Project } from '../../../src/features/projects/domain/project';
import type { Source } from '../../../server/src/sources/source';
import { AdminGate } from '../AdminGate';
import { ApiClient, ApiError } from '../api/client';
import { BatchesPage } from './BatchesPage';
import { Setup } from './Setup';
import { Soon } from './Soon';
import { UploadPage } from './UploadPage';

type Tab = 'upload' | 'batches' | 'results';
type Loaded =
  | { kind: 'loading' }
  | { kind: 'setup'; project: Project | null }
  | { kind: 'ready'; project: Project; source: Source }
  | { kind: 'error'; message: string };

export function AdminApp() {
  return <AdminGate purpose="manage your project">{({ client, onSignedOut }) => <Workspace client={client} onSignedOut={onSignedOut} />}</AdminGate>;
}

function Workspace({ client, onSignedOut }: { client: ApiClient; onSignedOut: () => void }) {
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('upload');

  const load = useCallback(async () => {
    try {
      const projects = (await client.projectList()).filter((project) => project.status === 'active');
      const project = projects[0];
      if (!project) { setState({ kind: 'setup', project: null }); return; }
      const sources = await client.sourceList(project.id);
      const source = sources.find((candidate) => candidate.status === 'approved');
      setState(source ? { kind: 'ready', project, source } : { kind: 'setup', project });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { onSignedOut(); return; }
      setState({ kind: 'error', message: cause instanceof Error ? cause.message : 'Something went wrong.' });
    }
  }, [client, onSignedOut]);
  useEffect(() => { void load(); }, [load]);

  if (state.kind === 'loading') return <main className="ad-center"><p className="ad-muted">Loading…</p></main>;
  if (state.kind === 'error') {
    return (
      <main className="ad-center">
        <div className="ad-card"><h1>We could not load your project</h1><p className="ad-error" role="alert">{state.message}</p><button onClick={() => { setState({ kind: 'loading' }); void load(); }}>Try again</button></div>
      </main>
    );
  }
  if (state.kind === 'setup') {
    return <Setup client={client} existingProject={state.project} onSignedOut={onSignedOut} onDone={(project, source) => setState({ kind: 'ready', project, source })} />;
  }

  const { project, source } = state;
  return (
    <div className="ad-shell">
      <header className="ad-header">
        <div className="ad-brand"><span className="ad-mark">S</span><div><strong>SautiForge</strong><small>{project.title}</small></div></div>
        <nav className="ad-nav" aria-label="Main">
          {([['upload', 'Upload'], ['batches', 'Batches'], ['results', 'Results']] as const).map(([id, label]) => (
            <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="ad-header-end">
          <a className="ad-link" href="#tools">Advanced</a>
          <button className="quiet ad-small" onClick={() => void client.logout().then(onSignedOut, () => onSignedOut())}>Sign out</button>
        </div>
      </header>
      <main className="ad-main">
        {tab === 'upload' ? <UploadPage client={client} project={project} source={source} onSignedOut={onSignedOut} /> : null}
        {tab === 'batches' ? <BatchesPage client={client} project={project} source={source} onSignedOut={onSignedOut} onGoUpload={() => setTab('upload')} /> : null}
        {tab === 'results' ? <Soon title="Results">See what the community wrote for each clip, how far each batch has come, and choose the final text.</Soon> : null}
      </main>
    </div>
  );
}
