import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import type { Identity } from '../auth/auth-session.service';
import { CurrentIdentity, RequireRoles } from '../auth/auth.guards';
import { CollaborationService } from './collaboration.service';
import { MarketplaceService } from './marketplace.service';
import { MediaService } from './media.service';
import { GroupDto, InvitationDto, IssueDto, IssueSearchDto, ListingDto, ListingSearchDto, ObservationDto, PageDto, PickupDto, PostDto, ProfileDto, RequestDto } from './stage5.dto';

@ApiTags('marketplace') @ApiBearerAuth() @Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly service: MarketplaceService) {}
  @Get('listings') list(@Query() query: ListingSearchDto) { return this.service.list(query); }
  @Get('listings/mine') mine(@CurrentIdentity() identity: Identity) { return this.service.mine(identity.user.id); }
  @Get('map') map(@Query() query: ListingSearchDto) { return this.service.markers(query); }
  @Get('recipients') recipients(@Query() query: ListingSearchDto) { return this.service.recipients(query); }
  @Get('recipients/map') recipientMap(@Query() query: ListingSearchDto) { return this.service.recipientMarkers(query); }
  @Get('organizations/pending') @RequireRoles(PlatformRole.ADMIN) pendingOrganizations() { return this.service.pendingOrganizations(); }
  @Get('requests') requests(@CurrentIdentity() identity: Identity) { return this.service.requests(identity.user.id); }
  @Get('listings/:id') get(@Param('id', ParseUUIDPipe) id: string) { return this.service.get(id); }
  @Put('organizations/:organizationId/profile') profile(@CurrentIdentity() identity: Identity, @Param('organizationId', ParseUUIDPipe) id: string, @Body() dto: ProfileDto) { return this.service.upsertProfile(identity.user.id, id, dto); }
  @Post('listings') create(@CurrentIdentity() identity: Identity, @Body() dto: ListingDto) { return this.service.create(identity.user.id, identity.user.roles, dto); }
  @Put('listings/:id') update(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ListingDto) { return this.service.update(identity.user.id, id, dto); }
  @Delete('listings/:id') remove(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) { return this.service.remove(identity.user.id, id); }
  @Post('listings/:id/requests') request(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestDto) { return this.service.request(identity.user.id, id, dto); }
  @Post('requests/:id/accept') accept(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PickupDto) { return this.service.transition(identity.user.id, id, 'accept', dto); }
  @Post('requests/:id/reject') reject(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(identity.user.id, id, 'reject'); }
  @Post('requests/:id/cancel') cancel(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(identity.user.id, id, 'cancel'); }
  @Post('requests/:id/fulfill') fulfill(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(identity.user.id, id, 'fulfill'); }
  @Post('organizations/:id/verify') @RequireRoles(PlatformRole.ADMIN) verify(@Param('id', ParseUUIDPipe) id: string) { return this.service.verifyOrganization(id); }
}

@ApiTags('collaboration') @ApiBearerAuth() @Controller('collaboration')
export class CollaborationController {
  constructor(private readonly service: CollaborationService) {}
  @Get('issues') issues(@Query() query: IssueSearchDto) { return this.service.issues(query); }
  @Post('issues') issue(@CurrentIdentity() identity: Identity, @Body() dto: IssueDto) { return this.service.createIssue(identity.user.id, identity.user.roles, dto); }
  @Get('issues/:id/similar') similar(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) { return this.service.similar(id, identity.user.id); }
  @Get('experts') experts(@Query() query: PageDto) { return this.service.experts(query); }
  @Get('groups') groups(@Query() query: PageDto) { return this.service.groups(query); }
  @Post('groups') groupCreate(@CurrentIdentity() identity: Identity, @Body() dto: GroupDto) { return this.service.createGroup(identity.user.id, identity.user.roles, dto); }
  @Get('groups/:id') group(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) { return this.service.group(identity.user.id, id); }
  @Post('groups/:id/join') join(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) { return this.service.join(identity.user.id, identity.user.roles, id); }
  @Post('groups/:id/invitations') invite(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InvitationDto) { return this.service.invite(identity.user.id, id, dto); }
  @Get('invitations') invitations(@CurrentIdentity() identity: Identity) { return this.service.invitations(identity.user.id); }
  @Post('invitations/:id/accept') accept(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) { return this.service.invitationDecision(identity.user.id, id, true); }
  @Post('invitations/:id/reject') reject(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) { return this.service.invitationDecision(identity.user.id, id, false); }
  @Post('groups/:id/posts') post(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto) { return this.service.post(identity.user.id, id, dto); }
  @Post('groups/:id/observations') observe(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ObservationDto) { return this.service.observe(identity.user.id, id, dto); }
}

@ApiTags('media') @ApiBearerAuth() @Controller('media')
export class MediaController {
  constructor(private readonly service: MediaService) {}
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5_000_000, files: 1, fields: 0 } }))
  upload(@CurrentIdentity() identity: Identity, @UploadedFile() file?: { buffer: Buffer; mimetype: string }) {
    return this.service.upload(identity.user.id, file);
  }
  @Get('view') view(@CurrentIdentity() identity: Identity, @Query('key') key: string) { return this.service.view(identity.user.id, key); }
}
