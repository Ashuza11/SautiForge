import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AdminApp } from './admin/AdminApp';
import { parseBatchHash } from './domain/volunteer-view';
import { VolunteerApp } from './volunteer/VolunteerApp';
import './styles.css';
import './admin/admin.css';
import './volunteer/volunteer.css';

/** The simple admin is the front page. The older tools stay one click away at #tools. */
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  if (hash.startsWith('#/b/')) {
    const link = parseBatchHash(hash);
    if (link) return <VolunteerApp link={link} />;
    return <main className="ad-center"><div className="ad-card"><h1>This link does not work</h1><p className="ad-muted">It looks incomplete. Please ask for the link again.</p></div></main>;
  }
  if (hash !== '#tools') return <AdminApp />;
  return (
    <>
      <div className="ad-tools-bar"><span>Advanced tools</span><a href="#">Back to the simple view</a></div>
      <App />
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('SautiForge web root is missing.');

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
