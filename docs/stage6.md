# Stage 6 realtime communication

Sign in on the marketplace, collaboration page, or map to connect to Socket.IO. The marketplace refreshes availability and organization requests. The map reloads resource, produce, and recipient markers. Collaboration refreshes issue reports, open research discussions, and farmer conversations. The notification inbox on each page keeps read status across tabs and sessions.

## Socket contract

The endpoint is WebSocket-only at `/realtime`. Supply the existing access JWT in `auth.token` and use the configured `WEB_ORIGIN` for browser requests. The server checks the JWT, session, and account at connection time. It rechecks session validity and scoped permissions before delivering events.

| Room                                             | Subscription and delivery                                                                                                                                                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user:<userId>`                                  | The server joins the authenticated user's sockets automatically. The client cannot request a user room. Direct conversation and match events reach only the specified participants. Inbox events also require access to the referenced notification. |
| `organization:<organizationId>`                  | Current members of an active organization can subscribe. The server checks membership again before delivering a request event. Request events go to the seller and requester organizations.                                                          |
| `group:<groupId>`                                | Current research group members can subscribe. Membership is checked before delivery.                                                                                                                                                                 |
| `topic:map`, `topic:marketplace`, `topic:issues` | Any authenticated user can subscribe. These rooms carry shared discovery updates. Map invalidations carry a layer name.                                                                                                                              |

- `room.join` and `room.leave` accept `{ kind: 'topic', topic }` or `{ kind: 'organization' | 'group', id }`.
- `presence.watch` and `presence.unwatch` accept `{ kind: 'group' | 'conversation', id }`. A successful watch returns an array of online user IDs. The server pushes `presence.updated(scope, onlineUserIds)` when that scoped list changes. Presence combines all tabs and replicas. A disconnected replica's last heartbeat expires after 24 seconds.
- `event.ack(eventId)` acknowledges an envelope delivered to that socket. Repeating the acknowledgement returns the same success while the receipt is cached.
- Commands acknowledge with `{ ok: true, data? }` or `{ ok: false, error }`. Errors are `invalid_input`, `forbidden`, and `unavailable`.

The shared TypeScript contract is in [realtime.ts](../packages/shared-types/src/realtime.ts). Server events use the `realtime.event` channel with `{ eventId, version: 1, occurredAt, type, payload }`. Timestamps are ISO 8601 UTC. Clients use the event as a signal to fetch the latest authorized snapshot.

| Type                                                           | Payload                                            | Audience                                                          |
| -------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `LISTING_CREATED`                                              | `listingId`                                        | Marketplace                                                       |
| `LISTING_UPDATED`                                              | `listingId`                                        | Marketplace for listing edits, owning organization for removals   |
| `LISTING_RESERVED`, `LISTING_FULFILLED`                        | `listingId, requestId, mode`                       | Seller and requester organizations                                |
| `DONATION_REQUESTED`, `DONATION_ACCEPTED`, `DONATION_DECLINED` | `listingId, requestId, mode`                       | Seller and requester organizations for donation and free listings |
| `PURCHASE_REQUESTED`, `PURCHASE_ACCEPTED`, `PURCHASE_DECLINED` | `listingId, requestId, mode`                       | Seller and requester organizations for sale listings              |
| `REQUEST_CANCELLED`                                            | `listingId, requestId, mode`                       | Seller and requester organizations                                |
| `PICKUP_SCHEDULED`                                             | `listingId, requestId, mode, pickupAt`             | Seller and requester organizations                                |
| `MAP_MARKER_UPDATED`                                           | `layer` is `resources`, `produce`, or `recipients` | Map and marketplace                                               |
| `AGRICULTURAL_ISSUE_CREATED`                                   | `issueId`                                          | Issues                                                            |
| `FARMER_MATCH_FOUND`                                           | `issueIds` of the matching reports                 | The two report authors                                            |
| `FARMER_MESSAGE_CREATED`                                       | `conversationId, messageId`                        | The two conversation participants                                 |
| `GROUP_MESSAGE_CREATED`                                        | `groupId, messageId`                               | Research group members                                            |
| `GROUP_ACTIVITY_UPDATED`                                       | `groupId`                                          | Research group members                                            |
| `NOTIFICATION_CREATED`, `NOTIFICATION_READ`                    | `notificationId`                                   | The inbox owner, subject to current organization or group access  |

## Durable state and recovery

- Domain writes, outbox rows, and inbox notifications commit in the same PostgreSQL transaction. New listings and issue reports notify active users. Request notifications go to the participating organizations, group notifications go to members, and direct messages notify the other participant.
- Each API replica runs a BullMQ worker. A periodic scan enqueues unpublished rows using the outbox UUID as the job ID. A worker locks the row, publishes through the Redis adapter to the active replicas, and marks it published after replica acknowledgements. Failed jobs retry with backoff. Rows still pending can be enqueued again. Keep `REALTIME_PREFIX` and `AUTH_JWT_SECRET` identical across replicas of the same deployment. Use distinct prefixes for isolated deployments sharing Redis.
- A crash during publication can repeat an event with the same UUID. The browser acknowledges deliveries and coalesces refreshes using a bounded UUID cache. Replica acknowledgement tracks publication. Browser acknowledgement is separate. The demo reconciles from REST on reconnect and every 30 seconds while signed in, so durable messages, unread counts, and map or marketplace state catch up after missed events.
- Marketplace requests and group posts accept an optional UUID `clientId`. Direct messages require it. Retry the same input with the same ID to retrieve the existing record. Reusing the ID with different content returns HTTP 409. Reservation transitions use the existing PostgreSQL locks and availability check.
- `GET /api/v1/realtime/notifications?cursor=<id>` returns 30 items, the total unread count, and an optional next cursor. `PATCH /api/v1/realtime/notifications/:id` accepts `{ read: boolean }`.
- `GET /api/v1/realtime/conversations` lists the caller's conversations. Start one with `POST /api/v1/realtime/conversations` and `{ issueId, matchedIssueId }` from an issue the caller authored. `GET /api/v1/realtime/conversations/:id/messages` returns the latest 100 messages, and `POST` on that path accepts `{ clientId, body }`. Research discussions reuse the existing group posts and authorized group detail endpoints.

## Demo verification

Use a disposable local PostgreSQL database with PostGIS and a running Redis instance. Set `DATABASE_URL` and `REDIS_URL`, then run:

```sh
pnpm db:generate
pnpm db:migrate:deploy
pnpm --filter @cropcircle/api test:realtime:integration
```

The test starts two NestJS replicas using real PostgreSQL and Redis. It verifies cross-replica delivery, room isolation and revoked access, concurrent reservations and repeated sends, read status and offline recovery, multiple-tab presence, and retry after an injected publication failure. Use two local accounts in separate browser profiles to try the same flows in the UI. The standard Redis adapter uses ephemeral Pub/Sub. PostgreSQL snapshots provide recovery and the demo keeps outbox history without automated pruning. [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/) [BullMQ connections](https://docs.bullmq.io/guide/connections)
