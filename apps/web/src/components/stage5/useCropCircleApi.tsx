'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRoot, loadAccessToken, refreshAccessToken, rememberAccessToken } from '../realtime/access-session';
import { useRealtime } from '../realtime/useRealtime';

type User = { id: string; displayName: string | null; roles: string[] };
export function useCropCircleApi() {
  const token = useRef('');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const renew = useCallback(async () => {
    const previous = token.current;
    const renewed = await refreshAccessToken();
    if (token.current !== previous) return token.current || null;
    token.current = renewed ?? '';
    if (!renewed) setUser(null);
    return renewed;
  }, []);
  const socket = useRealtime(!!user, token, renew);
  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const send = () => fetch(`${apiRoot}${path}`, { ...init, cache: 'no-store', headers: { ...init?.headers, Authorization: `Bearer ${token.current}` } });
    const used = token.current;
    let response = await send();
    if (response.status === 401 && (token.current !== used || await renew())) response = await send();
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? `Request failed (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }, [renew]);
  useEffect(() => {
    let live = true;
    loadAccessToken()
      .then(async access => {
        if (!access || !live) return;
        token.current = access;
        const me = await request<User>('/auth/me');
        if (live) setUser(me);
      }).catch(() => undefined).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [request]);
  const login = async (email: string, password: string) => {
    setError('');
    try {
      const response = await fetch(`${apiRoot}/auth/login`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      if (!response.ok) throw new Error('Sign in failed');
      const session = (await response.json()) as { accessToken: string; expiresIn: number };
      rememberAccessToken(session);
      token.current = session.accessToken;
      setUser(await request<User>('/auth/me'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign in failed'); }
  };
  const logout = async () => { await fetch(`${apiRoot}/auth/logout`, { method: 'POST', credentials: 'include' }); rememberAccessToken(); token.current = ''; setUser(null); };
  const json = useCallback(<T,>(path: string, method: string, body?: unknown) => request<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), [request]);
  const upload = async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    const info = await request<{ key: string }>('/media/upload', { method: 'POST', body });
    return info.key;
  };
  return { user, loading, error, setError, request, json, login, logout, upload, socket };
}

export function SignIn({ login, error }: { login: (email: string, password: string) => Promise<void>; error: string }) {
  const pathname = usePathname();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <main className="workspace-sign-in mx-auto w-[calc(100%-1.5rem)] max-w-md space-y-4 p-8">
      <h1 className="font-serif text-3xl">Sign in to CropCircle</h1>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void login(email, password); }}>
        <label className="block font-medium">
          Email
          <input className="mt-1 w-full rounded-lg border bg-white p-3" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />
        </label>
        <label className="block font-medium">
          Password
          <input className="mt-1 w-full rounded-lg border bg-white p-3" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
        </label>
        <button className="w-full rounded-lg bg-[#174531] px-4 py-3 font-semibold text-white hover:bg-[#23573e]">Sign in</button>
      </form>
      <p className="text-sm">New to CropCircle? <Link className="font-semibold underline" href={{ pathname: '/account', query: { returnTo: pathname } }}>Create an account</Link></p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </main>
  );
}
