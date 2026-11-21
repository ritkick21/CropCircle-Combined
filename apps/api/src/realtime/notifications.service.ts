import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { recordEvent } from './outbox';
import { RealtimeAccessService } from './realtime-access.service';

const historySelect = { id: true, type: true, title: true, createdAt: true, readAt: true } as const;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: RealtimeAccessService,
  ) {}

  async history(userId: string, cursor?: string) {
    const where = await this.access.notificationFilter(userId);
    if (
      cursor &&
      !(await this.db.realtimeNotification.findFirst({
        where: { ...where, id: cursor },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException();
    }
    const [rows, unread] = await Promise.all([
      this.db.realtimeNotification.findMany({
        where,
        select: historySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 31,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.db.realtimeNotification.count({ where: { ...where, readAt: null } }),
    ]);
    const items = rows.slice(0, 30);
    return { items, unread, nextCursor: rows.length > 30 ? items.at(-1)!.id : null };
  }

  async setRead(userId: string, id: string, read: boolean) {
    return this.db.$transaction(async (tx) => {
      const where = { ...(await this.access.notificationFilter(userId, tx)), id };
      const changed = await tx.realtimeNotification.updateMany({
        where: { ...where, readAt: read ? null : { not: null } },
        data: { readAt: read ? new Date() : null },
      });
      const item = await tx.realtimeNotification.findFirst({ where, select: historySelect });
      if (!item) throw new NotFoundException();
      if (changed.count)
        await recordEvent(tx, { type: 'NOTIFICATION_READ', payload: { notificationId: id } }, [
          { kind: 'notification', id, userId },
        ]);
      return item;
    });
  }
}
