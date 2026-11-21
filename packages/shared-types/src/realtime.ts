export type RealtimeTopic = 'map' | 'marketplace' | 'issues';

export type RoomSubscription =
  { kind: 'topic'; topic: RealtimeTopic } | { kind: 'organization' | 'group'; id: string };

export type PresenceScope = { kind: 'group'; id: string } | { kind: 'conversation'; id: string };

type ListingRef = { listingId: string };
type RequestRef = ListingRef & { requestId: string; mode: 'DONATION' | 'FREE' | 'SALE' };
type EventPayloads = {
  LISTING_CREATED: ListingRef;
  LISTING_UPDATED: ListingRef;
  LISTING_RESERVED: RequestRef;
  LISTING_FULFILLED: RequestRef;
  DONATION_REQUESTED: RequestRef;
  DONATION_ACCEPTED: RequestRef;
  DONATION_DECLINED: RequestRef;
  PURCHASE_REQUESTED: RequestRef;
  PURCHASE_ACCEPTED: RequestRef;
  PURCHASE_DECLINED: RequestRef;
  REQUEST_CANCELLED: RequestRef;
  PICKUP_SCHEDULED: RequestRef & { pickupAt: string };
  MAP_MARKER_UPDATED: { layer: 'resources' | 'produce' | 'recipients' };
  AGRICULTURAL_ISSUE_CREATED: { issueId: string };
  FARMER_MATCH_FOUND: { issueIds: [string, string] };
  FARMER_MESSAGE_CREATED: { conversationId: string; messageId: string };
  GROUP_MESSAGE_CREATED: { groupId: string; messageId: string };
  GROUP_ACTIVITY_UPDATED: { groupId: string };
  FARM_CASE_SHARED: { caseId: string };
  FARM_CASE_REPLIED: { caseId: string };
  NOTIFICATION_CREATED: { notificationId: string };
  NOTIFICATION_READ: { notificationId: string };
};

export type RealtimeEventType = keyof EventPayloads;
export type RealtimeEventData<K extends RealtimeEventType = RealtimeEventType> = {
  [Type in K]: { type: Type; payload: EventPayloads[Type] };
}[K];
export type RealtimeEvent = RealtimeEventData & {
  eventId: string;
  version: 1;
  occurredAt: string;
};

export type RealtimeAck<T = undefined> =
  { ok: true; data?: T } | { ok: false; error: 'invalid_input' | 'forbidden' | 'unavailable' };

export interface RealtimeServerEvents {
  'realtime.event': (event: RealtimeEvent) => void;
  'presence.updated': (scope: PresenceScope, online: string[]) => void;
}

export interface RealtimeClientEvents {
  'service.ping': (ack: (response: { status: 'ok'; service: 'api' }) => void) => void;
  'room.join': (scope: RoomSubscription, ack: (response: RealtimeAck) => void) => void;
  'room.leave': (scope: RoomSubscription, ack: (response: RealtimeAck) => void) => void;
  'event.ack': (eventId: string, ack: (response: RealtimeAck) => void) => void;
  'presence.watch': (scope: PresenceScope, ack: (response: RealtimeAck<string[]>) => void) => void;
  'presence.unwatch': (scope: PresenceScope, ack: (response: RealtimeAck) => void) => void;
}

export type NotificationItem = {
  id: string;
  type: RealtimeEventType;
  title: string;
  createdAt: string;
  readAt: string | null;
};

export type NotificationHistory = {
  items: NotificationItem[];
  unread: number;
  nextCursor: string | null;
};

export type FarmerConversationSummary = {
  id: string;
  peer: { id: string; displayName: string | null };
};

export type FarmerMessageItem = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};
