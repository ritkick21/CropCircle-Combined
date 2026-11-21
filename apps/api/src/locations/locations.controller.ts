import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import type { Identity } from '../auth/auth-session.service';
import { CurrentIdentity, RequireRoles } from '../auth/auth.guards';
import {
  CreateLocationDto,
  LocationQueryDto,
  MarkerQueryDto,
  PublishLocationDto,
  UpdateLocationDto,
} from './locations.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}
  @Get() list(@CurrentIdentity() identity: Identity, @Query() query: LocationQueryDto) {
    return this.locations.list(query, identity.user.id);
  }
  @Get('nearby') nearby(@CurrentIdentity() identity: Identity, @Query() query: LocationQueryDto) {
    return this.locations.list(query, identity.user.id, true);
  }
  @Get('mine') mine(@CurrentIdentity() identity: Identity) {
    return this.locations.mine(identity.user.id);
  }
  @Get('pending') @RequireRoles(PlatformRole.ADMIN) pending() {
    return this.locations.pending();
  }
  @Get(':id') get(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) {
    return this.locations.get(id, identity.user.id);
  }
  @Post('organizations/:organizationId') create(
    @CurrentIdentity() identity: Identity,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locations.create(organizationId, identity.user.id, dto);
  }
  @Patch(':id') update(
    @CurrentIdentity() identity: Identity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locations.update(id, identity.user.id, dto);
  }
  @Post(':id/publish') @RequireRoles(PlatformRole.ADMIN) publish(
    @CurrentIdentity() identity: Identity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishLocationDto,
  ) {
    return this.locations.publish(id, identity.user.id, dto.reason);
  }
}

@ApiTags('map')
@ApiBearerAuth()
@Controller('map')
export class MapController {
  constructor(private readonly locations: LocationsService) {}
  @Get('markers') markers(@CurrentIdentity() identity: Identity, @Query() query: MarkerQueryDto) {
    return this.locations.markers(query, identity.user.id);
  }
  @Get('filters') filters() {
    return this.locations.filters();
  }
}
