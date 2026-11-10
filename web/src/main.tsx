import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AdminApp } from './admin/AdminApp';
import './styles.css';
import './admin/admin.css';

/** The simple admin is the front page. The older tools stay one click away at #tools. */
function Root() {
  const [tools, setTools] = useState(window.location.hash === '#tools');
  useEffect(() => {
    const onChange = () => setTools(window.location.hash === '#tools');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  if (!tools) return <AdminApp />;
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
