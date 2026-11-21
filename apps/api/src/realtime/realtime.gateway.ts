import { ForbiddenException, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type {
  PresenceScope,
  RealtimeAck,
  RealtimeClientEvents,
  RealtimeEvent,
  RealtimeServerEvents,
  RealtimeTopic,
  RoomSubscription,
} from '@cropcircle/shared-types';
import { isUUID } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { activeAccount, AuthSessionService } from '../auth/auth-session.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { EventScope } from './outbox';
import { RealtimeAccessService } from './realtime-access.service';

interface ClusterEvents {
  'stage6.dispatch': (
    event: RealtimeEvent,
    scopes: EventScope[],
    ack: (ok: boolean) => void,
  ) => void;
}
type SocketIdentity = { userId: string; sessionId: string; accessExpiresAt: number };
type Client = Socket<RealtimeClientEvents, RealtimeServerEvents, ClusterEvents, SocketIdentity>;
type RealtimeServer = Server<
  RealtimeClientEvents,
  RealtimeServerEvents,
  ClusterEvents,
  SocketIdentity
>;
const topics = ['map', 'marketplace', 'issues'];
const room = (scope: EventScope) => {
  if (scope.kind === 'topic') return 'topic:' + scope.topic;
  if (scope.kind === 'notification') return 'user:' + scope.userId;
  return scope.kind + ':' + scope.id;
};
const leaseMs = 24_000;
const isId = (value: unknown): value is string => typeof value === 'string' && isUUID(value);

function roomInput(value: unknown): RoomSubscription | undefined {
  if (!value || typeof value !== 'object') return;
  const scope = value as Record<string, unknown>;
  if (scope.kind === 'topic' && typeof scope.topic === 'string' && topics.includes(scope.topic)) {
    return { kind: 'topic', topic: scope.topic as RealtimeTopic };
  }
  if ((scope.kind === 'organization' || scope.kind === 'group') && isId(scope.id))
    return { kind: scope.kind, id: scope.id.toLowerCase() };
}

function presenceInput(value: unknown): PresenceScope | undefined {
  if (!value || typeof value !== 'object') return;
  const scope = value as Record<string, unknown>;
  if ((scope.kind === 'group' || scope.kind === 'conversation') && isId(scope.id))
    return { kind: scope.kind, id: scope.id.toLowerCase() };
}

@WebSocketGateway({ path: '/realtime', transports: ['websocket'], maxHttpBufferSize: 16_384 })
export class RealtimeGateway implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly receipts = new WeakMap<Client, Map<string, boolean>>();
  private readonly watches = new WeakMap<
    Client,
    Map<string, { scope: PresenceScope; snapshot: string }>
  >();
  private server?: RealtimeServer;
  private timer?: NodeJS.Timeout;
  private heartbeatRunning = false;
  private readonly presencePrefix: string;

  constructor(
    private readonly config: ConfigService,
    private readonly sessions: AuthSessionService,
    private readonly access: RealtimeAccessService,
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly limits: AuthRateLimitService,
  ) {
    this.presencePrefix = config.getOrThrow<string>('REALTIME_PREFIX') + ':presence:';
  }

  afterInit(server: RealtimeServer) {
    this.server = server;
    server.use((socket, next) => {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== this.config.get('WEB_ORIGIN'))
        return next(new Error('forbidden_origin'));
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== 'string' || token.length > 4096) return next(new Error('unauthorized'));
      const forwarded = socket.handshake.headers['x-forwarded-for'];
      const ip = this.config.get('TRUST_PROXY') === '1' && typeof forwarded === 'string'
        ? forwarded.split(',').at(-1)?.trim() || socket.handshake.address
        : socket.handshake.address;
      void this.limits.consume('socket-connect', ip, 60, 60)
        .then(() => this.sessions.authenticate(token)).then(
        (identity) => {
          socket.data = {
            userId: identity.user.id,
            sessionId: identity.sessionId,
            accessExpiresAt: identity.accessExpiresAt,
          };
          next();
        },
        () => next(new Error('unauthorized')),
      );
    });
    server.on('stage6.dispatch', (event, scopes, ack) => {
      void this.deliver(event, scopes).then(
        () => ack(true),
        () => ack(false),
      );
    });
    this.timer = setInterval(() => {
      if (this.heartbeatRunning) return;
      this.heartbeatRunning = true;
      void this.heartbeat()
        .catch(() => this.logger.warn('Presence refresh failed'))
        .finally(() => {
          this.heartbeatRunning = false;
        });
    }, 4_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  handleConnection(socket: Client) {
    let windowStarted = Date.now();
    let packets = 0;
    socket.use((_packet, next) => {
      if (Date.now() - windowStarted >= 10_000) {
        windowStarted = Date.now();
        packets = 0;
      }
      if (++packets > 100) {
        socket.disconnect(true);
        return;
      }
      next();
    });
    this.receipts.set(socket, new Map());
    this.watches.set(socket, new Map());
    void socket.join('user:' + socket.data.userId);
    void this.updatePresence([socket]).catch(() =>
      this.logger.warn('Presence registration failed'),
    );
  }

  handleDisconnect(socket: Client) {
    if (this.redis.client.status !== 'ready') return;
    void this.redis.client
      .zrem(this.presencePrefix + socket.data.userId, socket.id)
      .catch(() => undefined);
  }

  @SubscribeMessage('service.ping')
  ping() {
    return { status: 'ok' as const, service: 'api' as const };
  }

  @SubscribeMessage('room.join')
  join(@ConnectedSocket() socket: Client, @MessageBody() input: unknown) {
    return this.command(socket, roomInput(input), async (scope) => {
      if (socket.rooms.size >= 64 && !socket.rooms.has(room(scope))) throw new ForbiddenException();
      if (!(await this.access.permits(socket.data.userId, scope))) throw new ForbiddenException();
      await socket.join(room(scope));
    });
  }

  @SubscribeMessage('room.leave')
  leave(@ConnectedSocket() socket: Client, @MessageBody() input: unknown) {
    return this.command(socket, roomInput(input), async (scope) => {
      await socket.leave(room(scope));
    });
  }

  @SubscribeMessage('event.ack')
  acknowledge(@ConnectedSocket() socket: Client, @MessageBody() input: unknown): RealtimeAck {
    if (!isId(input)) return { ok: false, error: 'invalid_input' };
    const delivered = this.receipts.get(socket);
    if (!delivered?.has(input)) return { ok: false, error: 'forbidden' };
    delivered.set(input, true);
    return { ok: true };
  }

  @SubscribeMessage('presence.watch')
  watch(@ConnectedSocket() socket: Client, @MessageBody() input: unknown) {
    return this.command(socket, presenceInput(input), async (scope) => {
      const watches = this.watches.get(socket)!;
      const key = scope.kind + ':' + scope.id;
      if (watches.size >= 4 && !watches.has(key)) throw new ForbiddenException();
      const online = await this.online(socket.data.userId, scope);
      watches.set(key, { scope, snapshot: online.join(',') });
      return online;
    });
  }

  @SubscribeMessage('presence.unwatch')
  unwatch(@ConnectedSocket() socket: Client, @MessageBody() input: unknown) {
    return this.command(socket, presenceInput(input), (scope) => {
      this.watches.get(socket)?.delete(scope.kind + ':' + scope.id);
    });
  }

  async publish(event: RealtimeEvent, scopes: EventScope[]) {
    const server = this.server;
    if (!server || this.redis.client.status !== 'ready')
      throw new Error('Realtime transport unavailable');
    await this.redis.ping();
    const [, responses] = await Promise.all([
      this.deliver(event, scopes),
      server.serverSideEmitWithAck('stage6.dispatch', event, scopes),
    ]);
    if (responses.some((ok) => !ok)) throw new Error('Replica could not dispatch event');
  }

  private async command<Input, Output>(
    socket: Client,
    input: Input | undefined,
    run: (input: Input) => Output | Promise<Output>,
  ): Promise<RealtimeAck<Output>> {
    if (input === undefined) return { ok: false, error: 'invalid_input' };
    try {
      if (!(await this.activeSockets([socket])).length) return { ok: false, error: 'forbidden' };
      return { ok: true, data: await run(input) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof ForbiddenException ? 'forbidden' : 'unavailable',
      };
    }
  }

  private async activeSockets(sockets: Client[]) {
    if (!sockets.length) return [];
    const sessions = await this.db.authSession.findMany({
      where: {
        id: { in: sockets.map((socket) => socket.data.sessionId) },
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: activeAccount,
      },
      select: { id: true },
    });
    const valid = new Set(sessions.map((session) => session.id));
    return sockets.filter((socket) => {
      if (!socket.connected) return false;
      if (socket.data.accessExpiresAt > Date.now() && valid.has(socket.data.sessionId)) return true;
      socket.disconnect(true);
      return false;
    });
  }

  private async deliver(event: RealtimeEvent, scopes: EventScope[]) {
    const sockets = this.server?.of('/').sockets;
    if (!sockets?.size) return;
    const candidates = [...sockets.values()].filter((socket) =>
      scopes.some((scope) => socket.rooms.has(room(scope))),
    );
    const authorized = new Map<string, Promise<boolean>>();
    await Promise.all(
      (await this.activeSockets(candidates)).map(async (socket) => {
        const permissions = await Promise.all(
          scopes
            .filter((scope) => socket.rooms.has(room(scope)))
            .map((scope) => {
              const key = [
                socket.data.userId,
                room(scope),
                scope.kind === 'notification' ? scope.id : '',
              ].join(':');
              if (!authorized.has(key))
                authorized.set(key, this.access.permits(socket.data.userId, scope));
              return authorized.get(key)!;
            }),
        );
        if (
          !socket.connected ||
          socket.data.accessExpiresAt <= Date.now() ||
          !permissions.some(Boolean)
        )
          return;
        const receipts = this.receipts.get(socket);
        if (!receipts || receipts.get(event.eventId)) return;
        if (receipts.size >= 256) receipts.delete(receipts.keys().next().value!);
        receipts.set(event.eventId, false);
        socket.emit('realtime.event', event);
      }),
    );
  }

  private async updatePresence(sockets: Client[]) {
    if (!sockets.length || this.redis.client.status !== 'ready') return;
    const now = Date.now();
    const pipeline = this.redis.client.pipeline();
    for (const socket of sockets) {
      const key = this.presencePrefix + socket.data.userId;
      pipeline
        .zremrangebyscore(key, '-inf', now)
        .zadd(key, now + leaseMs, socket.id)
        .pexpire(key, leaseMs);
    }
    await pipeline.exec();
  }

  private async online(userId: string, scope: PresenceScope) {
    const ids = (await this.access.presenceUsers(userId, scope)).sort();
    if (this.redis.client.status !== 'ready') throw new Error('Presence unavailable');
    if (!ids.length) return [];
    const pipeline = this.redis.client.pipeline();
    for (const id of ids) pipeline.zcount(this.presencePrefix + id, '(' + Date.now(), '+inf');
    const responses = await pipeline.exec();
    if (!responses || responses.some(([error]) => error)) throw new Error('Presence unavailable');
    return ids.filter((_, index) => Number(responses[index]?.[1]) > 0);
  }

  private async heartbeat() {
    const sockets = await this.activeSockets([...(this.server?.of('/').sockets.values() ?? [])]);
    await this.updatePresence(sockets);
    await Promise.all(
      sockets.map(async (socket) => {
        const watches = this.watches.get(socket);
        for (const [key, watch] of watches ?? []) {
          try {
            const online = await this.online(socket.data.userId, watch.scope);
            const snapshot = online.join(',');
            if (watch.snapshot !== snapshot && watches?.get(key) === watch) {
              watch.snapshot = snapshot;
              socket.emit('presence.updated', watch.scope, online);
            }
          } catch (error) {
            if (error instanceof ForbiddenException) watches?.delete(key);
          }
        }
      }),
    );
  }
}
