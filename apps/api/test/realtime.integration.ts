import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import type {
  FarmerConversationSummary,
  FarmerMessageItem,
  NotificationHistory,
  PresenceScope,
  RealtimeClientEvents,
  RealtimeAck,
  RealtimeEvent,
  RealtimeEventType,
  RealtimeServerEvents,
  RoomSubscription,
} from '@cropcircle/shared-types';

type Client = Socket<RealtimeServerEvents, RealtimeClientEvents>;
type Peer = { app: INestApplication; url: string };
type Id = { id: string };
if (process.env.REALTIME_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.REALTIME_TEST_DATABASE_URL;
if (process.env.REALTIME_TEST_REDIS_URL) process.env.REDIS_URL = process.env.REALTIME_TEST_REDIS_URL;
const db = new PrismaClient();
const peers: Peer[] = [];
const clients: Client[] = [];
const feeds = new Map<Client, RealtimeEvent[]>();
const fixtureUsers: string[] = [];
const fixtureOrgs: string[] = [];
const fixtureGroups: string[] = [];
const nonce = randomUUID().slice(0, 8);
const passwordHash = randomUUID();
const title = 'Stage 6 fixture ' + nonce;

async function start(): Promise<Peer> {
  // Load Nest's compiled decorators and DI metadata, as in the deployed API.
  const { AppModule } =
    (await import('../dist/app.module.js')) as typeof import('../src/app.module');
  const { RedisIoAdapter } =
    (await import('../dist/realtime/redis-io.adapter.js')) as typeof import('../src/realtime/redis-io.adapter');
  const { requestValidation } =
    (await import('../dist/config/validation.js')) as typeof import('../src/config/validation');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  const config = app.get(ConfigService);
  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis(
    config.getOrThrow<string>('REDIS_URL'),
    config.getOrThrow<string>('REALTIME_PREFIX'),
  );
  app.useWebSocketAdapter(adapter);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(requestValidation());
  await app.listen(0, '127.0.0.1');
  const peer = { app, url: await app.getUrl() };
  peers.push(peer);
  return peer;
}

async function api<T>(
  peer: Peer,
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
  status?: number,
): Promise<T> {
  const response = await fetch(peer.url + '/api/v1' + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (status) assert.equal(response.status, status, method + ' ' + path);
  else
    assert.ok(
      response.ok,
      method + ' ' + path + ' returned ' + response.status + ' ' + JSON.stringify(data),
    );
  return data as T;
}

async function account(peer: Peer, index: number) {
  const { AuthSessionService } =
    (await import('../dist/auth/auth-session.service.js')) as typeof import('../src/auth/auth-session.service');
  const user = await db.user.create({
    data: {
      email: 'stage6-' + nonce + '-' + index + '@example.invalid',
      displayName: title + ' user ' + index,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      passwordHash,
      roles: index === 0 ? ['FARMER', 'ADMIN'] : ['FARMER'],
    },
  });
  fixtureUsers.push(user.id);
  const organization = await db.organization.create({
    data: {
      name: title + ' organization ' + index,
      type: index === 0 ? 'farm' : 'food_bank',
      verifiedAt: new Date(),
      memberships: { create: { userId: user.id, role: 'OWNER' } },
    },
  });
  fixtureOrgs.push(organization.id);
  const session = await peer.app.get(AuthSessionService).create(user.id, passwordHash);
  return { id: user.id, org: organization.id, token: session.accessToken };
}

function client(peer: Peer, token?: string, origin?: string): Client {
  const socket: Client = io(peer.url, {
    path: '/realtime',
    transports: ['websocket'],
    auth: { token },
    autoConnect: false,
    reconnectionDelay: 600,
    reconnectionDelayMax: 800,
    randomizationFactor: 0,
    ...(origin ? { extraHeaders: { Origin: origin } } : {}),
  });
  const feed: RealtimeEvent[] = [];
  socket.on('realtime.event', (event) => feed.push(event));
  feeds.set(socket, feed);
  clients.push(socket);
  return socket;
}

async function until<T>(
  check: () => T | undefined | Promise<T | undefined>,
  message: string,
): Promise<T> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== undefined) return result;
    await delay(30);
  }
  assert.fail(message);
}

async function connect(socket: Client) {
  socket.connect();
  await until(() => socket.connected || undefined, 'Socket did not connect');
}

async function rejectsConnection(socket: Client, reason: string) {
  let error: Error | undefined;
  socket.once('connect_error', (cause) => {
    error = cause;
  });
  socket.connect();
  assert.equal((await until(() => error, 'Expected connection rejection')).message, reason);
  assert.equal(socket.connected, false);
}

async function join(socket: Client, subscription: RoomSubscription, allowed = true) {
  const result = (await socket
    .timeout(3_000)
    .emitWithAck('room.join', subscription)) as RealtimeAck;
  assert.deepEqual(result, allowed ? { ok: true } : { ok: false, error: 'forbidden' });
}

function has(
  socket: Client,
  type: RealtimeEventType,
  predicate: (event: RealtimeEvent) => boolean = () => true,
) {
  return feeds.get(socket)?.find((event) => event.type === type && predicate(event));
}

function received(
  socket: Client,
  type: RealtimeEventType,
  predicate?: (event: RealtimeEvent) => boolean,
) {
  return until(() => has(socket, type, predicate), 'Expected ' + type);
}

function ref(event: RealtimeEvent, key: string, id: string) {
  return (event.payload as Record<string, unknown>)[key] === id;
}

async function main() {
  assert.ok(
    process.env.DATABASE_URL && process.env.REDIS_URL,
    'Set DATABASE_URL and REDIS_URL for a local fixture stack',
  );
  process.env.AUTH_JWT_SECRET ??= randomBytes(32).toString('base64url');
  process.env.REALTIME_PREFIX = 'cropcircle-stage6-test-' + nonce;
  const [a, b] = await Promise.all([start(), start()]);
  const seller = await account(a, 0);
  const buyer = await account(a, 1);
  const outsider = await account(a, 2);
  const buyer2 = await account(a, 3);
  await rejectsConnection(client(a), 'unauthorized');
  await rejectsConnection(client(a, 'invalid'), 'unauthorized');
  await rejectsConnection(
    client(a, seller.token, 'http://other-origin.invalid'),
    'forbidden_origin',
  );

  const farmSocket = client(a, seller.token);
  const buyerSocket = client(b, buyer.token);
  const buyerTab = client(a, buyer.token);
  const stranger = client(b, outsider.token);
  const buyer2Socket = client(b, buyer2.token);
  await Promise.all([farmSocket, buyerSocket, buyerTab, stranger, buyer2Socket].map(connect));
  assert.deepEqual(await farmSocket.timeout(3_000).emitWithAck('service.ping'), {
    status: 'ok',
    service: 'api',
  });
  await Promise.all([
    join(farmSocket, { kind: 'organization', id: seller.org }),
    join(buyerSocket, { kind: 'organization', id: buyer.org }),
    join(buyerTab, { kind: 'organization', id: buyer.org }),
    join(buyer2Socket, { kind: 'organization', id: buyer2.org }),
    join(stranger, { kind: 'organization', id: seller.org }, false),
    join(stranger, { kind: 'topic', topic: 'marketplace' }),
    join(buyerSocket, { kind: 'topic', topic: 'map' }),
    join(stranger, { kind: 'topic', topic: 'issues' }),
  ]);
  const forged = { kind: 'user', id: seller.id } as unknown as RoomSubscription;
  assert.deepEqual(await stranger.timeout(3_000).emitWithAck('room.join', forged), {
    ok: false,
    error: 'invalid_input',
  });

  const { id: locationId } = await api<Id>(
    a,
    seller.token,
    '/locations/organizations/' + seller.org,
    'POST',
    {
      category: 'FARMER',
      name: title + ' pickup site',
      lng: -73.97,
      lat: 40.71,
      available: true,
    },
  );
  await api(a, seller.token, '/locations/' + locationId + '/publish', 'POST', {
    reason: 'Verified integration pickup location',
  });
  const resourceEvent = await received(
    buyerSocket,
    'MAP_MARKER_UPDATED',
    (event) => event.type === 'MAP_MARKER_UPDATED' && event.payload.layer === 'resources',
  );
  assert.deepEqual(resourceEvent.payload, { layer: 'resources' });
  const listing = {
    organizationId: seller.org,
    locationId,
    cropName: title + ' tomatoes',
    quantity: 10,
    unit: 'KG',
    harvestDate: new Date().toISOString(),
    quality: 'Good',
    storageConditions: 'Cool',
    shelfLifeDays: 7,
    pickupAvailability: 'Demo pickup',
    mode: 'DONATION',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const { id: listingId } = await api<Id>(
    a,
    seller.token,
    '/marketplace/listings',
    'POST',
    listing,
  );
  const created = await received(stranger, 'LISTING_CREATED', (event) =>
    ref(event, 'listingId', listingId),
  );
  assert.equal(created.version, 1);
  assert.deepEqual(await stranger.timeout(3_000).emitWithAck('event.ack', created.eventId), {
    ok: true,
  });
  assert.deepEqual(await stranger.timeout(3_000).emitWithAck('event.ack', created.eventId), {
    ok: true,
  });
  assert.deepEqual(await stranger.timeout(3_000).emitWithAck('event.ack', randomUUID()), {
    ok: false,
    error: 'forbidden',
  });
  await received(
    buyerSocket,
    'MAP_MARKER_UPDATED',
    (event) => event.type === 'MAP_MARKER_UPDATED' && event.payload.layer === 'produce',
  );
  const map = await api<{ items: { id: string; lng: number; availableQuantity: string }[] }>(
    b,
    buyer.token,
    '/marketplace/map',
  );
  assert.ok(
    map.items.some(
      (item) => item.id === listingId && item.lng === -74 && item.availableQuantity === '10',
    ),
  );
  await api(a, seller.token, '/marketplace/listings/' + listingId, 'PUT', {
    ...listing,
    quality: 'Demo grade',
  });
  await received(stranger, 'LISTING_UPDATED', (event) => ref(event, 'listingId', listingId));

  const listingNotice = (
    await api<NotificationHistory>(b, buyer.token, '/realtime/notifications')
  ).items.find((item) => item.type === 'LISTING_CREATED');
  assert.ok(listingNotice);
  await api(
    b,
    outsider.token,
    '/realtime/notifications/' + listingNotice.id,
    'PATCH',
    { read: true },
    404,
  );
  await api(b, buyer.token, '/realtime/notifications/' + listingNotice.id, 'PATCH', { read: true });
  await received(buyerTab, 'NOTIFICATION_READ', (event) =>
    ref(event, 'notificationId', listingNotice.id),
  );
  assert.equal(
    (await api<NotificationHistory>(a, buyer.token, '/realtime/notifications')).unread,
    0,
  );
  await api(b, buyer.token, '/realtime/notifications/' + listingNotice.id, 'PATCH', {
    read: false,
  });
  assert.equal(
    (await api<NotificationHistory>(a, buyer.token, '/realtime/notifications')).unread,
    1,
  );

  const path = '/marketplace/listings/' + listingId + '/requests';
  const order = { organizationId: buyer.org, quantity: 7, clientId: randomUUID() };
  const [first, duplicate, second] = await Promise.all([
    api<Id>(a, buyer.token, path, 'POST', order),
    api<Id>(b, buyer.token, path, 'POST', order),
    api<Id>(b, buyer2.token, path, 'POST', { ...order, organizationId: buyer2.org }),
  ]);
  assert.equal(first.id, duplicate.id);
  await api(b, buyer.token, path, 'POST', { ...order, quantity: 6 }, 409);
  const forFirst = (event: RealtimeEvent) => ref(event, 'requestId', first.id);
  await received(farmSocket, 'DONATION_REQUESTED', forFirst);
  await received(buyerSocket, 'DONATION_REQUESTED', forFirst);
  assert.equal(has(stranger, 'DONATION_REQUESTED'), undefined);
  assert.equal(has(buyer2Socket, 'DONATION_REQUESTED', forFirst), undefined);
  assert.equal(
    await db.realtimeOutbox.count({
      where: {
        AND: [
          { event: { path: ['type'], equals: 'DONATION_REQUESTED' } },
          { event: { path: ['payload', 'requestId'], equals: first.id } },
        ],
      },
    }),
    1,
  );

  const pickupAt = new Date(Date.now() + 3_600_000).toISOString();
  const requestPath = (id: string, action: string) => '/marketplace/requests/' + id + '/' + action;
  const accepted = await Promise.all([
    fetch(a.url + '/api/v1' + requestPath(first.id, 'accept'), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + seller.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pickupAt }),
    }),
    fetch(b.url + '/api/v1' + requestPath(second.id, 'accept'), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + seller.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pickupAt }),
    }),
  ]);
  assert.deepEqual(accepted.map((response) => response.status).sort(), [201, 409]);
  const winner = accepted[0].ok
    ? { request: first, socket: buyerSocket }
    : { request: second, socket: buyer2Socket };
  const loser = accepted[0].ok
    ? { request: second, socket: buyer2Socket }
    : { request: first, socket: buyerSocket };
  const winningEvent = (event: RealtimeEvent) => ref(event, 'requestId', winner.request.id);
  await received(winner.socket, 'DONATION_ACCEPTED', winningEvent);
  await received(winner.socket, 'LISTING_RESERVED', winningEvent);
  const pickup = await received(winner.socket, 'PICKUP_SCHEDULED', winningEvent);
  assert.equal(pickup.type === 'PICKUP_SCHEDULED' && pickup.payload.pickupAt, pickupAt);
  await api(a, seller.token, requestPath(loser.request.id, 'reject'), 'POST');
  await received(loser.socket, 'DONATION_DECLINED', (event) =>
    ref(event, 'requestId', loser.request.id),
  );
  await api(b, seller.token, requestPath(winner.request.id, 'fulfill'), 'POST');
  await received(winner.socket, 'LISTING_FULFILLED', winningEvent);
  assert.equal(
    String((await db.cropListing.findUniqueOrThrow({ where: { id: listingId } })).quantity),
    '3',
  );
  const { id: saleId } = await api<Id>(a, seller.token, '/marketplace/listings', 'POST', {
    ...listing,
    mode: 'SALE',
    price: 2,
  });
  const sale = await api<Id>(
    b,
    buyer.token,
    '/marketplace/listings/' + saleId + '/requests',
    'POST',
    { organizationId: buyer.org, quantity: 2 },
  );
  const forSale = (event: RealtimeEvent) => ref(event, 'requestId', sale.id);
  await received(farmSocket, 'PURCHASE_REQUESTED', forSale);
  await api(a, seller.token, requestPath(sale.id, 'accept'), 'POST', { pickupAt });
  await received(buyerSocket, 'PURCHASE_ACCEPTED', forSale);
  await api(b, buyer.token, requestPath(sale.id, 'cancel'), 'POST');
  await received(farmSocket, 'REQUEST_CANCELLED', forSale);

  const group = await api<Id>(a, seller.token, '/collaboration/groups', 'POST', {
    name: title,
    description: 'Fixture group',
    cropTypes: [],
    interests: [],
  });
  fixtureGroups.push(group.id);
  await api(b, buyer.token, '/collaboration/groups/' + group.id + '/join', 'POST');
  const groupRoom = { kind: 'group' as const, id: group.id };
  await Promise.all([
    join(farmSocket, groupRoom),
    join(buyerSocket, groupRoom),
    join(stranger, groupRoom, false),
  ]);
  assert.deepEqual(await stranger.timeout(3_000).emitWithAck('presence.watch', groupRoom), {
    ok: false,
    error: 'forbidden',
  });
  const initial = (await farmSocket
    .timeout(3_000)
    .emitWithAck('presence.watch', groupRoom)) as RealtimeAck<string[]>;
  assert.ok(initial.ok && initial.data?.includes(buyer.id));
  const onlineUpdates: string[][] = [];
  farmSocket.on('presence.updated', (scope: PresenceScope, online) => {
    if (scope.kind === 'group' && scope.id === group.id) onlineUpdates.push(online);
  });
  buyerSocket.disconnect();
  assert.ok(
    await until(
      () => buyerTab.connected || undefined,
      'Second buyer tab disconnected unexpectedly',
    ),
  );
  const stillOnline = (await farmSocket
    .timeout(3_000)
    .emitWithAck('presence.watch', groupRoom)) as RealtimeAck<string[]>;
  assert.ok(stillOnline.ok && stillOnline.data?.includes(buyer.id));
  buyerTab.disconnect();
  await until(
    () => onlineUpdates.find((online) => !online.includes(buyer.id)),
    'Buyer never appeared offline',
  );

  const groupPath = '/collaboration/groups/' + group.id;
  const post = { body: 'Local field notes', clientId: randomUUID() };
  const [one, two] = await Promise.all([
    api<Id>(a, seller.token, groupPath + '/posts', 'POST', post),
    api<Id>(b, seller.token, groupPath + '/posts', 'POST', post),
  ]);
  assert.equal(one.id, two.id);
  await api(b, seller.token, groupPath + '/posts', 'POST', { ...post, body: 'Changed' }, 409);
  await received(farmSocket, 'GROUP_MESSAGE_CREATED', (event) => ref(event, 'messageId', one.id));
  assert.equal(has(buyerSocket, 'GROUP_MESSAGE_CREATED'), undefined);
  await connect(buyerSocket);
  await join(buyerSocket, groupRoom);
  const recovered = await api<{ posts: Id[] }>(b, buyer.token, groupPath);
  assert.deepEqual(
    recovered.posts.map((item) => item.id),
    [one.id],
  );
  const missed = (
    await api<NotificationHistory>(b, buyer.token, '/realtime/notifications')
  ).items.find((item) => item.type === 'GROUP_MESSAGE_CREATED');
  assert.ok(missed && !missed.readAt);

  let rejoined = false;
  buyerSocket.once('connect', () => {
    void join(buyerSocket, groupRoom).then(() => {
      rejoined = true;
    });
  });
  buyerSocket.io.engine.close();
  await until(
    () => rejoined || undefined,
    'Transport reconnection did not restore group subscription',
  );
  const livePost = await api<Id>(a, seller.token, groupPath + '/posts', 'POST', {
    body: 'After reconnect',
  });
  await received(buyerSocket, 'GROUP_MESSAGE_CREATED', (event) =>
    ref(event, 'messageId', livePost.id),
  );
  assert.equal(has(stranger, 'GROUP_MESSAGE_CREATED'), undefined);
  await db.groupMembership.delete({
    where: { groupId_userId: { groupId: group.id, userId: buyer.id } },
  });
  const privatePost = await api<Id>(a, seller.token, groupPath + '/posts', 'POST', {
    body: 'Only current members',
  });
  await received(farmSocket, 'GROUP_MESSAGE_CREATED', (event) =>
    ref(event, 'messageId', privatePost.id),
  );
  await join(buyerSocket, groupRoom, false);
  assert.equal(
    has(buyerSocket, 'GROUP_MESSAGE_CREATED', (event) => ref(event, 'messageId', privatePost.id)),
    undefined,
  );
  assert.equal(
    (await api<NotificationHistory>(b, buyer.token, '/realtime/notifications')).items.some(
      (item) => item.id === missed.id,
    ),
    false,
  );

  const issue = {
    title,
    cropType: 'Tomato ' + nonce,
    category: 'IRRIGATION',
    symptoms: 'Uneven soil moisture in a fixture bed',
    region: 'Fixture county',
    observedAt: new Date().toISOString(),
  };
  const [source, match] = await Promise.all([
    api<Id>(a, seller.token, '/collaboration/issues', 'POST', issue),
    api<Id>(b, buyer.token, '/collaboration/issues', 'POST', { ...issue, title: title + ' peer' }),
  ]);
  await received(stranger, 'AGRICULTURAL_ISSUE_CREATED', (event) =>
    ref(event, 'issueId', source.id),
  );
  await received(
    buyerSocket,
    'FARMER_MATCH_FOUND',
    (event) => event.type === 'FARMER_MATCH_FOUND' && event.payload.issueIds.includes(source.id),
  );
  assert.equal(has(stranger, 'FARMER_MATCH_FOUND'), undefined);
  await api(
    b,
    outsider.token,
    '/realtime/conversations',
    'POST',
    { issueId: source.id, matchedIssueId: match.id },
    403,
  );
  const conversation = await api<FarmerConversationSummary>(
    a,
    seller.token,
    '/realtime/conversations',
    'POST',
    { issueId: source.id, matchedIssueId: match.id },
  );
  const messagePath = '/realtime/conversations/' + conversation.id + '/messages';
  await api(b, outsider.token, messagePath, 'GET', undefined, 403);
  assert.deepEqual(
    await stranger
      .timeout(3_000)
      .emitWithAck('presence.watch', { kind: 'conversation', id: conversation.id }),
    { ok: false, error: 'forbidden' },
  );
  const messageInput = { body: 'Compare watering schedules?', clientId: randomUUID() };
  const messages = await Promise.all([
    api<Id>(a, seller.token, messagePath, 'POST', messageInput),
    api<Id>(b, seller.token, messagePath, 'POST', messageInput),
  ]);
  assert.equal(messages[0].id, messages[1].id);
  await received(buyerSocket, 'FARMER_MESSAGE_CREATED', (event) =>
    ref(event, 'messageId', messages[0].id),
  );
  assert.deepEqual(
    (await api<FarmerMessageItem[]>(b, buyer.token, messagePath)).map((item) => item.body),
    [messageInput.body],
  );
  assert.equal(has(stranger, 'FARMER_MESSAGE_CREATED'), undefined);

  const { RealtimeGateway } =
    (await import('../dist/realtime/realtime.gateway.js')) as typeof import('../src/realtime/realtime.gateway');
  const gateways = peers.map((peer) => peer.app.get(RealtimeGateway));
  const publish = gateways.map((gateway) => gateway.publish.bind(gateway));
  for (const gateway of gateways)
    gateway.publish = () => Promise.reject(new Error('Fixture temporary publication failure'));
  const { id: delayed } = await api<Id>(a, seller.token, '/marketplace/listings', 'POST', {
    ...listing,
    cropName: title + ' delayed',
  });
  await delay(1_300);
  const queued = await db.realtimeOutbox.findFirstOrThrow({
    where: { event: { path: ['payload', 'listingId'], equals: delayed } },
  });
  assert.equal(queued.publishedAt, null);
  assert.ok(
    (await api<NotificationHistory>(b, buyer.token, '/realtime/notifications')).items.some((item) =>
      item.title.includes('delayed'),
    ),
  );
  assert.equal(
    has(stranger, 'LISTING_CREATED', (event) => ref(event, 'listingId', delayed)),
    undefined,
  );
  gateways.forEach((gateway, index) => {
    gateway.publish = publish[index]!;
  });
  const retried = await received(stranger, 'LISTING_CREATED', (event) =>
    ref(event, 'listingId', delayed),
  );
  assert.equal(retried.eventId, queued.id);

  // A previously joined socket must stop seeing private organization events immediately.
  const recent = await api<Id>(
    b,
    buyer2.token,
    '/marketplace/listings/' + saleId + '/requests',
    'POST',
    { organizationId: buyer2.org, quantity: 1 },
  );
  const recentRequest = (event: RealtimeEvent) => ref(event, 'requestId', recent.id);
  await received(buyer2Socket, 'PURCHASE_REQUESTED', recentRequest);
  await db.organizationMembership.updateMany({
    where: { userId: buyer2.id, organizationId: buyer2.org },
    data: { deletedAt: new Date() },
  });
  await api(a, seller.token, requestPath(recent.id, 'reject'), 'POST');
  const declined = await received(farmSocket, 'PURCHASE_DECLINED', recentRequest);
  await until(
    async () =>
      (await db.realtimeOutbox.findUnique({ where: { id: declined.eventId } }))?.publishedAt ??
      undefined,
    'Decline did not finish across replicas',
  );
  await join(buyer2Socket, { kind: 'organization', id: buyer2.org }, false);
  assert.equal(has(buyer2Socket, 'PURCHASE_DECLINED', recentRequest), undefined);
  await db.authSession.updateMany({
    where: { userId: outsider.id },
    data: { revokedAt: new Date() },
  });
  await until(() => !stranger.connected || undefined, 'Revoked session kept its socket');
  await rejectsConnection(client(b, outsider.token), 'unauthorized');

  console.log('Stage 6 integration passed across two API replicas');
}

async function cleanup() {
  for (const socket of clients) socket.disconnect();
  await Promise.all(peers.map((peer) => peer.app.close()));
  const userIds = { in: fixtureUsers };
  const organizationIds = { in: fixtureOrgs };
  const groupIds = { in: fixtureGroups };
  await db.groupPost.deleteMany({ where: { groupId: groupIds } });
  await db.groupMembership.deleteMany({ where: { groupId: groupIds } });
  await db.researchGroup.deleteMany({ where: { id: groupIds } });
  await db.issueReport.deleteMany({ where: { authorId: userIds } });
  await db.marketplaceRequest.deleteMany({ where: { organizationId: organizationIds } });
  await db.cropListing.deleteMany({ where: { organizationId: organizationIds } });
  await db.resourceLocationReview.deleteMany({ where: { reviewerId: userIds } });
  await db.resourceLocation.deleteMany({ where: { organizationId: organizationIds } });
  await db.organizationMembership.deleteMany({ where: { organizationId: organizationIds } });
  await db.organization.deleteMany({ where: { id: organizationIds } });
  await db.authSession.deleteMany({ where: { userId: userIds } });
  await db.user.deleteMany({ where: { id: userIds } });
  await db.$disconnect();
}

void (async () => {
  try {
    await main();
  } finally {
    await cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
