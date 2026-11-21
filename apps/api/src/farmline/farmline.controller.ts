import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import type { Identity } from '../auth/auth-session.service';
import { CurrentIdentity, RequireRoles } from '../auth/auth.guards';
import {
  CreateFarmCaseDto,
  CreateFarmResourceDto,
  CreateFarmTrialDto,
  ReplyFarmCaseDto,
  ShareFarmCaseDto,
  SolveFarmCaseDto,
} from './farmline.dto';
import { FarmlineService } from './farmline.service';

@ApiTags('farmline')
@ApiBearerAuth()
@Controller('farmline')
export class FarmlineController {
  constructor(private readonly farmline: FarmlineService) {}

  @Get()
  workspace(@CurrentIdentity() { user }: Identity) {
    return this.farmline.workspace(user);
  }

  @Post('cases')
  create(@CurrentIdentity() { user }: Identity, @Body() dto: CreateFarmCaseDto) {
    return this.farmline.create(user.id, dto);
  }

  @Post('cases/:id/share')
  @HttpCode(204)
  share(
    @CurrentIdentity() { user }: Identity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShareFarmCaseDto,
  ) {
    return this.farmline.share(user.id, id, dto);
  }

  @Post('cases/:id/replies')
  @HttpCode(204)
  reply(
    @CurrentIdentity() { user }: Identity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyFarmCaseDto,
  ) {
    return this.farmline.reply(user, id, dto);
  }

  @Post('cases/:id/solve')
  @HttpCode(204)
  solve(
    @CurrentIdentity() { user }: Identity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SolveFarmCaseDto,
  ) {
    return this.farmline.solve(user.id, id, dto);
  }

  @Post('trials')
  @RequireRoles(PlatformRole.RESEARCHER, PlatformRole.PROFESSIONAL)
  @HttpCode(204)
  addTrial(@CurrentIdentity() { user }: Identity, @Body() dto: CreateFarmTrialDto) {
    return this.farmline.addTrial(user.id, dto);
  }

  @Delete('trials/:id')
  @RequireRoles(PlatformRole.RESEARCHER, PlatformRole.PROFESSIONAL)
  @HttpCode(204)
  removeTrial(@CurrentIdentity() { user }: Identity, @Param('id', ParseUUIDPipe) id: string) {
    return this.farmline.removeTrial(user.id, id);
  }

  @Post('resources')
  @RequireRoles(PlatformRole.RESEARCHER, PlatformRole.PROFESSIONAL)
  @HttpCode(204)
  addResource(@CurrentIdentity() { user }: Identity, @Body() dto: CreateFarmResourceDto) {
    return this.farmline.addResource(user.id, dto);
  }
}
