import type { RealtimeEventData, RealtimeTopic, RoomSubscription } from '@cropcircle/shared-types';
import type { Prisma } from '@prisma/client';
import { activeAccount } from '../auth/auth-session.service';
import { activeOrganization } from '../organizations/organization-access.service';

export type EventScope =
  | RoomSubscription
  | { kind: 'user'; id: string }
  | { kind: 'notification'; id: string; userId: string };

export const topic = (name: RealtimeTopic): EventScope => ({ kind: 'topic', topic: name });
export const userRoom = (id: string): EventScope => ({ kind: 'user', id });

export function recordEvent(
  tx: Prisma.TransactionClient,
  event: RealtimeEventData,
  scopes: EventScope[],
) {
  return tx.realtimeOutbox.create({ data: { event, scopes } });
}

type Audience =
  | { kind: 'everyone' }
  | { kind: 'users'; ids: string[] }
  | { kind: 'organizations'; ids: string[] }
  | { kind: 'group'; id: string };

export async function notify(
  tx: Prisma.TransactionClient,
  type: RealtimeEventData['type'],
  title: string,
  audience: Audience,
  actorId?: string,
) {
  const where: Prisma.UserWhereInput = {
    ...activeAccount,
    ...(actorId ? { NOT: { id: actorId } } : {}),
  };
  if (audience.kind === 'users') where.id = { in: audience.ids };
  if (audience.kind === 'organizations')
    where.memberships = {
      some: {
        organizationId: { in: audience.ids },
        deletedAt: null,
        organization: activeOrganization,
      },
    };
  if (audience.kind === 'group') where.groupMemberships = { some: { groupId: audience.id } };

  const users = await tx.user.findMany({ where, select: { id: true } });
  if (!users.length) return;
  const items = await tx.realtimeNotification.createManyAndReturn({
    data: users.map(({ id }) => ({
      userId: id,
      type,
      title,
      organizationIds: audience.kind === 'organizations' ? audience.ids : [],
      groupId: audience.kind === 'group' ? audience.id : null,
    })),
    select: { id: true, userId: true },
  });
  await tx.realtimeOutbox.createMany({
    data: items.map(({ id, userId }) => ({
      event: {
        type: 'NOTIFICATION_CREATED',
        payload: { notificationId: id },
      } satisfies RealtimeEventData,
      scopes: [{ kind: 'notification', id, userId }] satisfies EventScope[],
    })),
  });
}

export async function mapChanged(
  tx: Prisma.TransactionClient,
  layer: 'resources' | 'produce' | 'recipients',
) {
  await recordEvent(tx, { type: 'MAP_MARKER_UPDATED', payload: { layer } }, [
    topic('map'),
    topic('marketplace'),
  ]);
}
