import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { Identity } from '../auth/auth-session.service';
import { CurrentIdentity } from '../auth/auth.guards';
import { FarmerMessagesService } from './farmer-messages.service';
import { NotificationsService } from './notifications.service';

class HistoryQuery {
  @IsOptional() @IsUUID() cursor?: string;
}

class ReadDto {
  @IsBoolean() read!: boolean;
}

class ConversationDto {
  @IsUUID() issueId!: string;
  @IsUUID() matchedIssueId!: string;
}

class FarmerMessageDto {
  @IsUUID() clientId!: string;
  @IsString() @Length(1, 3000) body!: string;
}

@ApiTags('realtime')
@ApiBearerAuth()
@Controller('realtime')
export class RealtimeController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly farmers: FarmerMessagesService,
  ) {}

  @Get('notifications')
  history(@CurrentIdentity() { user }: Identity, @Query() query: HistoryQuery) {
    return this.notifications.history(user.id, query.cursor);
  }

  @Patch('notifications/:id')
  read(
    @CurrentIdentity() { user }: Identity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReadDto,
  ) {
    return this.notifications.setRead(user.id, id, dto.read);
  }

  @Get('conversations')
  list(@CurrentIdentity() { user }: Identity) {
    return this.farmers.list(user.id);
  }

  @Post('conversations')
  start(@CurrentIdentity() { user }: Identity, @Body() dto: ConversationDto) {
    return this.farmers.start(user.id, dto.issueId, dto.matchedIssueId);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentIdentity() { user }: Identity, @Param('id', ParseUUIDPipe) id: string) {
    return this.farmers.messages(user.id, id);
  }

  @Post('conversations/:id/messages')
  send(
    @CurrentIdentity() { user }: Identity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FarmerMessageDto,
  ) {
    return this.farmers.send(user.id, id, dto.clientId, dto.body);
  }
}
