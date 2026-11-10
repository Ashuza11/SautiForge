import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiClient, ApiError } from './api/client';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '';

type GateContext = { client: ApiClient; onSignedOut: () => void };

/** Shows the admin sign-in form until the service accepts the password, then renders the screen. */
export function AdminGate({ purpose, children }: { purpose: string; children: (context: GateContext) => ReactNode }) {
  const client = useMemo(() => new ApiClient(API_BASE_URL), []);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client.isSignedIn().then(setSignedIn, (cause: unknown) => {
      setError(cause instanceof ApiError ? cause.message : 'The service could not be reached.');
      setSignedIn(false);
    });
  }, [client]);

  if (signedIn === null) return <main className="ad-center"><p className="ad-muted">Checking your session…</p></main>;
  if (!signedIn) return <SignIn client={client} purpose={purpose} initialError={error} onSignedIn={() => setSignedIn(true)} />;
  return <>{children({ client, onSignedOut: () => setSignedIn(false) })}</>;
}

function SignIn({ client, purpose, initialError, onSignedIn }: { client: ApiClient; purpose: string; initialError: string | null; onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.login(password);
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ad-center">
      <form className="ad-card ad-signin" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="ad-brand"><span className="ad-mark">S</span><span>SautiForge</span></div>
        <h1>Admin sign in</h1>
        <p className="ad-muted">Enter the admin password to {purpose}.</p>
        <label className="ad-field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        </label>
        {error ? <p className="ad-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || password.length === 0}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
