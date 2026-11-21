'use client';

export const apiRoot = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

let pending: Promise<string | null> | undefined;
type Session = { accessToken: string; expiresIn: number };
let active: { token: string; expiresAt: number } | undefined;
let generation = 0;

export function rememberAccessToken(session?: Session) {
  ++generation;
  active = session
    ? { token: session.accessToken, expiresAt: Date.now() + session.expiresIn * 1000 }
    : undefined;
}

export function loadAccessToken() {
  if (active && active.expiresAt > Date.now() + 10_000) return Promise.resolve(active.token);
  return refreshAccessToken();
}

export function refreshAccessToken(): Promise<string | null> {
  if (pending) return pending;
  const revision = generation;
  const refresh = async () => {
    const response = await fetch(apiRoot + '/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      keepalive: true,
    });
    if (generation !== revision) return active?.token ?? null;
    if (response.status === 401) {
      rememberAccessToken();
      return null;
    }
    if (!response.ok) throw new Error('Session refresh unavailable');
    const session = (await response.json()) as Session;
    if (generation !== revision) return active?.token ?? null;
    rememberAccessToken(session);
    return session.accessToken;
  };
  // Refresh cookies rotate. Serialize requests from tabs on the same origin.
  const operation = async () =>
    navigator.locks
      ? await navigator.locks.request('cropcircle-session-refresh', refresh)
      : refresh();
  pending = operation().finally(() => {
    pending = undefined;
  });
  return pending;
}
