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

  if (signedIn === null) return <main className="seg-review"><p className="seg-note">Checking your session…</p></main>;
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
    <main className="seg-review">
      <form className="seg-empty" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h2>Admin sign in</h2>
        <p>Enter the admin password to {purpose}.</p>
        <label className="clips-field">Password
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        </label>
        {error ? <div className="error" role="alert">{error}</div> : null}
        <button type="submit" disabled={busy || password.length === 0}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
