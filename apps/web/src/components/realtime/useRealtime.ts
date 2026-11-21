'use client';

import type {
  PresenceScope,
  RealtimeClientEvents,
  RealtimeEvent,
  RealtimeServerEvents,
  RoomSubscription,
} from '@cropcircle/shared-types';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiRoot } from './access-session';

export type RealtimeSocket = Socket<RealtimeServerEvents, RealtimeClientEvents>;
type TokenProvider = { current: string };

export function useRealtime(
  enabled: boolean,
  token: TokenProvider,
  renew: () => Promise<string | null>,
) {
  const [socket, setSocket] = useState<RealtimeSocket | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const client: RealtimeSocket = io(new URL(apiRoot, window.location.origin).origin, {
      path: '/realtime',
      transports: ['websocket'],
      autoConnect: false,
      auth: (callback) => callback({ token: token.current }),
      reconnectionDelayMax: 5_000,
    });
    let closed = false;
    let renewal: Promise<void> | undefined;
    const recover = () => {
      if (closed || renewal || client.connected || client.active) return;
      renewal = renew()
        .then((access) => {
          if (access && !closed) client.connect();
        })
        .catch(() => undefined)
        .finally(() => {
          renewal = undefined;
        });
    };
    client.on('connect_error', recover);
    client.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') recover();
    });
    client.on('realtime.event', (event) => {
      client.timeout(3_000).emit('event.ack', event.eventId, () => undefined);
    });
    setSocket(client);
    client.connect();
    const retry = window.setInterval(recover, 5_000);
    return () => {
      closed = true;
      window.clearInterval(retry);
      client.removeAllListeners();
      client.disconnect();
    };
  }, [enabled, renew, token]);
  return enabled ? socket : null;
}

export function useRooms(
  socket: RealtimeSocket | null,
  rooms: RoomSubscription[],
  onJoined?: () => void,
) {
  const key = JSON.stringify(rooms);
  const joined = useRef(onJoined);
  const previous = useRef<{ socket: RealtimeSocket; scopes: RoomSubscription[] } | null>(null);
  useEffect(() => {
    joined.current = onJoined;
  }, [onJoined]);
  useEffect(() => {
    if (!socket) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const scopes = JSON.parse(key) as RoomSubscription[];
    const retained = new Set(scopes.map((scope) => JSON.stringify(scope)));
    if (socket.connected && previous.current?.socket === socket) {
      for (const scope of previous.current.scopes) {
        if (!retained.has(JSON.stringify(scope))) socket.emit('room.leave', scope, () => undefined);
      }
    }
    previous.current = { socket, scopes };
    const join = () => {
      clearTimeout(retry);
      if (!active || !socket.connected) return;
      void Promise.all(
        scopes.map((scope) =>
          socket
            .timeout(3_000)
            .emitWithAck('room.join', scope)
            .catch(() => null),
        ),
      ).then((results) => {
        if (!active || !socket.connected) return;
        if (results.some((result) => result?.ok)) joined.current?.();
        if (results.some((result) => !result || (!result.ok && result.error === 'unavailable')))
          retry = setTimeout(join, 3_000);
      });
    };
    socket.on('connect', join);
    if (socket.connected) join();
    return () => {
      active = false;
      clearTimeout(retry);
      socket.off('connect', join);
    };
  }, [key, socket]);
}

export function useRealtimeRefresh(
  socket: RealtimeSocket | null,
  refresh: () => void | Promise<void>,
  matches: (event: RealtimeEvent) => boolean,
  enabled: boolean,
) {
  const latest = useRef({ refresh, matches });
  useEffect(() => {
    latest.current = { refresh, matches };
  }, [refresh, matches]);
  useEffect(() => {
    if (!enabled) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const schedule = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = undefined;
        void latest.current.refresh();
      }, 120);
    };
    const receive = (event: RealtimeEvent) => {
      if (event.version !== 1 || seen.has(event.eventId) || !latest.current.matches(event)) return;
      if (seen.size >= 512) seen.delete(seen.values().next().value!);
      seen.add(event.eventId);
      schedule();
    };
    socket?.on('realtime.event', receive);
    socket?.on('connect', schedule);
    window.addEventListener('online', schedule);
    const fallback = setInterval(schedule, 30_000);
    if (socket?.connected) schedule();
    return () => {
      clearTimeout(debounce);
      clearInterval(fallback);
      window.removeEventListener('online', schedule);
      socket?.off('realtime.event', receive);
      socket?.off('connect', schedule);
    };
  }, [enabled, socket]);
}

export function usePresence(
  socket: RealtimeSocket | null,
  kind: PresenceScope['kind'],
  id?: string,
) {
  const [online, setOnline] = useState<{ id: string; users: string[] } | null>(null);
  useEffect(() => {
    if (!socket || !id) return;
    const scope = { kind, id } as PresenceScope;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const update = (received: PresenceScope, users: string[]) => {
      if (active && received.kind === kind && received.id === id) setOnline({ id, users });
    };
    const watch = () => {
      clearTimeout(retry);
      if (!active || !socket.connected) return;
      void socket
        .timeout(3_000)
        .emitWithAck('presence.watch', scope)
        .then((result) => {
          if (!active) return;
          if (result.ok) update(scope, result.data ?? []);
          else if (result.error === 'unavailable') retry = setTimeout(watch, 3_000);
        })
        .catch(() => {
          if (active) retry = setTimeout(watch, 3_000);
        });
    };
    const offline = () => setOnline(null);
    socket.on('connect', watch).on('disconnect', offline).on('presence.updated', update);
    watch();
    return () => {
      active = false;
      clearTimeout(retry);
      socket.off('connect', watch).off('disconnect', offline).off('presence.updated', update);
      if (socket.connected) socket.emit('presence.unwatch', scope, () => undefined);
    };
  }, [socket, kind, id]);
  return online?.id === id ? online?.users : undefined;
}
