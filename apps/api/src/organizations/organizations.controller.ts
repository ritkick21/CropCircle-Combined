import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import type { Identity } from '../auth/auth-session.service';
import { TokenDto } from '../auth/auth.dto';
import { CurrentIdentity, RequireRoles } from '../auth/auth.guards';
import {
  OrganizationMembershipGuard,
  RequireOrganizationMembership,
} from './organization-membership.guard';
import { CreateOrganizationDto, InviteOrganizationMemberDto } from './organizations.dto';
import { managers, OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth()
@RequireRoles(PlatformRole.USER)
@UseGuards(OrganizationMembershipGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Post()
  async create(@CurrentIdentity() identity: Identity, @Body() dto: CreateOrganizationDto) {
    await this.rateLimit.consume('organization:create', identity.user.id, 10, 60 * 60);
    return this.organizations.create(identity.user.id, dto);
  }

  @Get()
  mine(@CurrentIdentity() identity: Identity) {
    return this.organizations.mine(identity.user.id);
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@CurrentIdentity() identity: Identity, @Body() dto: TokenDto) {
    await this.rateLimit.consume('organization:invitation:accept', identity.user.id, 30, 60 * 60);
    return this.organizations.accept(identity.user, dto.token);
  }

  @Get(':organizationId')
  @RequireOrganizationMembership()
  get(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.organizations.get(organizationId);
  }

  @Get(':organizationId/members')
  @RequireOrganizationMembership(...managers)
  members(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.organizations.members(organizationId);
  }

  @Post(':organizationId/invitations')
  @RequireOrganizationMembership(...managers)
  @HttpCode(HttpStatus.ACCEPTED)
  async invite(
    @CurrentIdentity() identity: Identity,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: InviteOrganizationMemberDto,
  ): Promise<void> {
    await this.rateLimit.consume('organization:invitation:send', identity.user.id, 20, 60 * 60);
    await this.organizations.invite(identity.user.id, organizationId, dto);
  }

  @Delete(':organizationId/members/:membershipId')
  @RequireOrganizationMembership(...managers)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentIdentity() identity: Identity,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.organizations.remove(identity.user.id, organizationId, membershipId);
  }
}
