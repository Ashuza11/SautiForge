import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AdminApp } from './admin/AdminApp';
import './styles.css';
import './admin/admin.css';

/** The simple admin is the front page. The older tools stay one click away at #tools. */
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  if (hash.startsWith('#/b/')) {
    return <main className="ad-center"><div className="ad-card"><h1>Thank you!</h1><p className="ad-muted">This link works. The page where you listen and write opens very soon.</p></div></main>;
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
