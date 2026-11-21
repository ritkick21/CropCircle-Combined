import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PresenceScope } from '@cropcircle/shared-types';
import type { Prisma } from '@prisma/client';
import { activeAccount } from '../auth/auth-session.service';
import { activeOrganization } from '../organizations/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { EventScope } from './outbox';

@Injectable()
export class RealtimeAccessService {
  constructor(private readonly db: PrismaService) {}

  async notificationFilter(userId: string, tx: Prisma.TransactionClient = this.db) {
    const [orgs, groups] = await Promise.all([
      tx.organizationMembership.findMany({
        where: { userId, deletedAt: null, organization: activeOrganization },
        select: { organizationId: true },
      }),
      tx.groupMembership.findMany({ where: { userId }, select: { groupId: true } }),
    ]);
    return {
      userId,
      AND: [
        {
          OR: [
            { organizationIds: { isEmpty: true } },
            { organizationIds: { hasSome: orgs.map((org) => org.organizationId) } },
          ],
        },
        { OR: [{ groupId: null }, { groupId: { in: groups.map((group) => group.groupId) } }] },
      ],
    } satisfies Prisma.RealtimeNotificationWhereInput;
  }

  async permits(userId: string, scope: EventScope): Promise<boolean> {
    switch (scope.kind) {
      case 'topic':
        return true;
      case 'user':
        return scope.id === userId;
      case 'organization':
        return !!(await this.db.organizationMembership.findFirst({
          where: {
            userId,
            organizationId: scope.id,
            deletedAt: null,
            organization: activeOrganization,
            user: activeAccount,
          },
          select: { id: true },
        }));
      case 'group':
        return !!(await this.db.groupMembership.findUnique({
          where: { groupId_userId: { groupId: scope.id, userId } },
          select: { id: true },
        }));
      case 'notification':
        if (scope.userId !== userId) return false;
        return !!(await this.db.realtimeNotification.findFirst({
          where: { ...(await this.notificationFilter(userId)), id: scope.id },
          select: { id: true },
        }));
    }
  }

  async conversation(userId: string, id: string, tx: Prisma.TransactionClient = this.db) {
    const item = await tx.farmerConversation.findFirst({
      where: { id, OR: [{ participantAId: userId }, { participantBId: userId }] },
      select: { id: true, participantAId: true, participantBId: true },
    });
    if (!item) throw new ForbiddenException('Conversation access denied');
    return item;
  }

  async presenceUsers(userId: string, scope: PresenceScope): Promise<string[]> {
    if (scope.kind === 'group') {
      if (!(await this.permits(userId, scope))) throw new ForbiddenException();
      const members = await this.db.groupMembership.findMany({
        where: { groupId: scope.id, user: activeAccount },
        select: { userId: true },
      });
      return members.map((member) => member.userId);
    }
    const item = await this.conversation(userId, scope.id);
    return [item.participantAId, item.participantBId];
  }
}
