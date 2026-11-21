import { ForbiddenException, Injectable } from '@nestjs/common';
import type { OrganizationRole, Prisma } from '@prisma/client';
import { activeAccount } from '../auth/auth-session.service';
import { PrismaService } from '../prisma/prisma.service';

export const activeOrganization = { deletedAt: null, suspendedAt: null };

@Injectable()
export class OrganizationAccessService {
  constructor(private readonly db: PrismaService) {}

  async require(
    userId: string,
    organizationId: string,
    roles: readonly OrganizationRole[] = [],
    tx: Prisma.TransactionClient = this.db,
  ): Promise<OrganizationRole> {
    const membership = await tx.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        deletedAt: null,
        organization: activeOrganization,
        user: activeAccount,
      },
      select: { role: true },
    });
    if (!membership || (roles.length > 0 && !roles.includes(membership.role))) {
      throw new ForbiddenException('Organization access denied');
    }
    return membership.role;
  }
}
