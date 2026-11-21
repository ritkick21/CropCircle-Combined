import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationRole, Prisma } from '@prisma/client';
import { AuthMailService } from '../auth/auth-mail.service';
import { activeAccount, type Principal } from '../auth/auth-session.service';
import { day, hashToken, randomToken } from '../auth/credentials';
import { PrismaService } from '../prisma/prisma.service';
import { activeOrganization, OrganizationAccessService } from './organization-access.service';
import type { CreateOrganizationDto, InviteOrganizationMemberDto } from './organizations.dto';

const organizationProjection = {
  id: true,
  name: true,
  type: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

export const managers = [OrganizationRole.OWNER, OrganizationRole.MANAGER] as const;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly mail: AuthMailService,
  ) {}

  create(userId: string, input: CreateOrganizationDto) {
    return this.db.organization.create({
      data: {
        name: input.name,
        type: input.type,
        memberships: { create: { userId, role: OrganizationRole.OWNER } },
      },
      select: organizationProjection,
    });
  }

  async mine(userId: string) {
    const memberships = await this.db.organizationMembership.findMany({
      where: { userId, deletedAt: null, organization: activeOrganization },
      select: { role: true, organization: { select: organizationProjection } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return memberships.map(({ organization, role }) => ({ ...organization, membershipRole: role }));
  }

  async get(organizationId: string) {
    const organization = await this.db.organization.findFirst({
      where: { id: organizationId, ...activeOrganization },
      select: organizationProjection,
    });
    if (!organization) throw new NotFoundException('Organization unavailable');
    return organization;
  }

  members(organizationId: string) {
    return this.db.organizationMembership.findMany({
      where: {
        organizationId,
        deletedAt: null,
        organization: activeOrganization,
        user: activeAccount,
      },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, displayName: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async invite(
    userId: string,
    organizationId: string,
    input: InviteOrganizationMemberDto,
  ): Promise<void> {
    const code = randomToken();
    const organization = await this.db.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const role = await this.access.require(userId, organizationId, managers, tx);
      this.requireAssignableRole(role, input.role);
      const existing = await tx.organizationMembership.findFirst({
        where: { organizationId, deletedAt: null, user: { email: input.email } },
        select: { id: true },
      });
      if (existing) throw new ConflictException('This account is already a member');

      const where = { organizationId_email: { organizationId, email: input.email } };
      const pending = await tx.organizationInvitation.findUnique({ where });
      if (pending && pending.expiresAt > new Date()) this.requireAssignableRole(role, pending.role);

      const invitation = {
        role: input.role,
        invitedById: userId,
        tokenHash: hashToken(code),
        expiresAt: new Date(Date.now() + 7 * day),
      };
      return tx.organizationInvitation.upsert({
        where,
        create: { ...invitation, organizationId, email: input.email },
        update: invitation,
        select: { organization: { select: { name: true } } },
      });
    });
    this.mail.send(
      input.email,
      'CropCircle organization invitation',
      `You were invited to join ${organization.organization.name}. Accept using this code:\n\n${code}\n\nIt expires in 7 days.`,
    );
  }

  async accept(user: Principal, token: string) {
    const where = {
      tokenHash: hashToken(token),
      email: user.email,
      expiresAt: { gt: new Date() },
      organization: activeOrganization,
    } satisfies Prisma.OrganizationInvitationWhereInput;
    const invitation = await this.db.organizationInvitation.findFirst({
      where,
      select: { organizationId: true },
    });
    if (!invitation) throw new BadRequestException('Invalid or expired invitation');

    return this.db.$transaction(async (tx) => {
      await this.lockOrganization(tx, invitation.organizationId);
      const pending = await tx.organizationInvitation.findFirst({
        where: { ...where, expiresAt: { gt: new Date() } },
      });
      if (!pending) throw new BadRequestException('Invalid or expired invitation');
      const currentRole = await this.access.require(
        pending.invitedById,
        pending.organizationId,
        managers,
        tx,
      );
      this.requireAssignableRole(currentRole, pending.role);

      const membershipKey = { organizationId: pending.organizationId, userId: user.id };
      const membership = await tx.organizationMembership.findUnique({
        where: { organizationId_userId: membershipKey },
      });
      if (membership && !membership.deletedAt)
        throw new ConflictException('This account is already a member');

      await tx.organizationInvitation.delete({ where: { id: pending.id } });
      return tx.organizationMembership.upsert({
        where: { organizationId_userId: membershipKey },
        create: { ...membershipKey, role: pending.role },
        update: { deletedAt: null, role: pending.role },
        select: { id: true, organizationId: true, role: true },
      });
    });
  }

  async remove(userId: string, organizationId: string, membershipId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const role = await this.access.require(userId, organizationId, managers, tx);
      const target = await tx.organizationMembership.findFirst({
        where: { id: membershipId, organizationId, deletedAt: null },
        select: { id: true, role: true, userId: true },
      });
      if (!target) throw new NotFoundException('Membership unavailable');
      this.requireAssignableRole(role, target.role);
      await tx.organizationMembership.update({
        where: { id: target.id },
        data: { deletedAt: new Date() },
      });
      await tx.organizationInvitation.deleteMany({
        where: { organizationId, invitedById: target.userId },
      });
    });
  }

  private requireAssignableRole(actor: OrganizationRole, target: OrganizationRole): void {
    if (
      target === OrganizationRole.OWNER ||
      (target === OrganizationRole.MANAGER && actor !== OrganizationRole.OWNER)
    ) {
      throw new ForbiddenException('Organization role cannot be managed by this member');
    }
  }

  // Membership updates and invitation acceptance serialize inside each organization.
  private async lockOrganization(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
  }
}
