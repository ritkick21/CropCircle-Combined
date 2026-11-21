import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { OrganizationRole } from '@prisma/client';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { identityFrom } from '../auth/auth.guards';
import { OrganizationAccessService } from './organization-access.service';

const membershipKey = Symbol('organizationMembership');

export const RequireOrganizationMembership = (...roles: OrganizationRole[]) =>
  SetMetadata(membershipKey, roles);

@Injectable()
export class OrganizationMembershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: OrganizationAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<OrganizationRole[]>(membershipKey, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) return true;

    const organizationId = context.switchToHttp().getRequest<Request>().params.organizationId;
    if (typeof organizationId !== 'string' || !isUUID(organizationId)) {
      throw new BadRequestException('Invalid organization ID');
    }
    await this.access.require(identityFrom(context).user.id, organizationId, roles);
    return true;
  }
}
