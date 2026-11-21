'use client';

import type { NotificationHistory, NotificationItem } from '@cropcircle/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeRefresh, type RealtimeSocket } from './useRealtime';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export function Notifications({
  socket,
  request,
}: {
  socket: RealtimeSocket | null;
  request: Request;
}) {
  const [history, setHistory] = useState<NotificationHistory>({
    items: [],
    unread: 0,
    nextCursor: null,
  });
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef({ value: 0 }).current;
  const refresh = useCallback(async () => {
    const current = ++sequence.value;
    try {
      const result = await request<NotificationHistory>(
        '/realtime/notifications' + (cursor ? '?cursor=' + cursor : ''),
      );
      if (current === sequence.value) {
        setHistory(result);
        setError('');
      }
    } catch {
      if (current === sequence.value) setError('Unable to load notifications.');
    }
  }, [request, cursor, sequence]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.value++;
    };
  }, [refresh, sequence]);
  useRealtimeRefresh(
    socket,
    refresh,
    (event) => event.type === 'NOTIFICATION_CREATED' || event.type === 'NOTIFICATION_READ',
    true,
  );

  const toggleRead = async (item: NotificationItem) => {
    setBusy(true);
    try {
      await request('/realtime/notifications/' + item.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: item.readAt === null }),
      });
      await refresh();
    } catch {
      setError('Unable to update notification.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="relative text-sm">
      <summary className="cursor-pointer rounded border px-2 py-1" aria-live="polite">
        Notifications{history.unread > 0 && <span> ({history.unread} unread)</span>}
      </summary>
      <section
        aria-label="Notification history"
        className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded border bg-white p-3 shadow-lg sm:w-80"
      >
        <h2 className="font-semibold">Notification history</h2>
        {error && (
          <p role="alert" className="mt-2 text-red-700">
            {error}
          </p>
        )}
        {!error && !history.items.length && (
          <p className="mt-2 text-gray-600">No notifications yet.</p>
        )}
        <ul className="max-h-80 divide-y overflow-auto">
          {history.items.map((item) => (
            <li key={item.id} className="space-y-1 py-2">
              <p className={item.readAt ? '' : 'font-semibold'}>{item.title}</p>
              <time dateTime={item.createdAt} className="block text-xs text-gray-600">
                {new Date(item.createdAt).toLocaleString()}
              </time>
              <button
                className="underline disabled:opacity-50"
                disabled={busy}
                onClick={() => void toggleRead(item)}
              >
                {item.readAt ? 'Mark unread' : 'Mark read'}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-3">
          {cursor && (
            <button className="underline" onClick={() => setCursor(null)}>
              Latest
            </button>
          )}
          {history.nextCursor && (
            <button className="underline" onClick={() => setCursor(history.nextCursor)}>
              Older
            </button>
          )}
        </div>
      </section>
    </details>
  );
}
