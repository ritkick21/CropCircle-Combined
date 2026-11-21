'use client';

import type { FarmerConversationSummary, FarmerMessageItem } from '@cropcircle/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePresence, useRealtimeRefresh, type RealtimeSocket } from './useRealtime';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export function FarmerMessages({
  socket,
  request,
  userId,
  conversationId,
  onOpen,
}: {
  socket: RealtimeSocket | null;
  request: Request;
  userId: string;
  conversationId: string;
  onOpen: (id: string) => void;
}) {
  const [conversations, setConversations] = useState<FarmerConversationSummary[]>([]);
  const [messages, setMessages] = useState<{
    conversationId: string;
    items: FarmerMessageItem[];
  }>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef({ value: 0 }).current;
  const pending = useRef<{ conversationId: string; body: string; id: string } | undefined>(
    undefined,
  );
  const online = usePresence(socket, 'conversation', conversationId || undefined);
  const selected = conversations.find((item) => item.id === conversationId);
  const refresh = useCallback(async () => {
    const current = ++sequence.value;
    try {
      const list = await request<FarmerConversationSummary[]>('/realtime/conversations');
      if (current !== sequence.value) return;
      setConversations(list);
      if (!conversationId || !list.some((item) => item.id === conversationId)) return;
      const items = await request<FarmerMessageItem[]>(
        '/realtime/conversations/' + conversationId + '/messages',
      );
      if (current !== sequence.value) return;
      setMessages({ conversationId, items: items.reverse() });
    } catch {
      if (current === sequence.value) setError('Unable to load farmer messages.');
    }
  }, [request, conversationId, sequence]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.value++;
    };
  }, [refresh, sequence]);
  useRealtimeRefresh(socket, refresh, (event) => event.type === 'FARMER_MESSAGE_CREATED', true);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    const prior = pending.current;
    const id =
      prior?.conversationId === conversationId && prior.body === body
        ? prior.id
        : crypto.randomUUID();
    pending.current = { conversationId, body, id };
    setBusy(true);
    setError('');
    try {
      await request('/realtime/conversations/' + conversationId + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, clientId: id }),
      });
      pending.current = undefined;
      setDraft('');
      await refresh();
    } catch {
      setError('Unable to send message. You can retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="farmer-messages"
      aria-label="Farmer messages"
      className="space-y-3 rounded border bg-white p-4"
    >
      <h2 className="text-xl font-semibold">Farmer messages</h2>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {conversations.length === 0 && (
        <p className="text-sm text-gray-600">
          Open a similar report from one of your issues to start a conversation.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {conversations.map((item) => (
          <button
            key={item.id}
            disabled={busy}
            aria-pressed={item.id === conversationId}
            className="rounded border px-3 py-1 text-sm aria-pressed:bg-green-100"
            onClick={() => {
              setDraft('');
              setError('');
              onOpen(item.id);
            }}
          >
            {item.peer.displayName ?? 'Farmer'}
          </button>
        ))}
      </div>
      {selected && (
        <>
          <h3 className="font-semibold">
            {selected.peer.displayName ?? 'Farmer'}
            {online && (
              <span className="ml-2 text-xs font-normal" aria-live="polite">
                {online.includes(selected.peer.id) ? 'Online' : 'Offline'}
              </span>
            )}
          </h3>
          <ul aria-live="polite" className="max-h-72 space-y-2 overflow-auto">
            {messages?.conversationId === conversationId &&
              messages.items.map((item) => (
                <li key={item.id} className="rounded bg-gray-50 p-2 text-sm">
                  <strong>
                    {item.senderId === userId ? 'You' : (selected.peer.displayName ?? 'Farmer')}
                  </strong>
                  <p className="whitespace-pre-wrap break-words">{item.body}</p>
                </li>
              ))}
          </ul>
          <form className="flex flex-wrap gap-2" onSubmit={(event) => void send(event)}>
            <textarea
              aria-label="Farmer message"
              className="min-w-40 flex-1 rounded border p-2"
              required
              maxLength={3000}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              disabled={busy || !draft.trim()}
              className="self-end rounded bg-green-800 px-3 py-2 text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </>
      )}
    </section>
  );
}
