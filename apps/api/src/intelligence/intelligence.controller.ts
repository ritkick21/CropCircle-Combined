import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { activeAccount, type Identity } from '../auth/auth-session.service';
import { CurrentIdentity, RequireRoles } from '../auth/auth.guards';
import { fileMatchesType } from '../config/file-content';
import {
  activeOrganization,
  OrganizationAccessService,
} from '../organizations/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ClassificationDto, DashboardQuery, ForecastDto } from './intelligence.dto';
import { jobSummary, SustainabilityService } from './sustainability.service';

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

@ApiTags('intelligence')
@ApiBearerAuth()
@Controller('intelligence')
export class IntelligenceController {
  constructor(
    private readonly db: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly sustainability: SustainabilityService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentIdentity() identity: Identity, @Query() query: DashboardQuery) {
    return this.sustainability.dashboard(identity, query);
  }

  @Get('models')
  async models(): Promise<unknown> {
    const cache = this.redis.client;
    const key = `${this.config.getOrThrow<string>('REALTIME_PREFIX')}:model-inventory`;
    const cached = cache.status === 'ready' ? await cache.get(key).catch(() => null) : null;
    if (cached) return JSON.parse(cached) as unknown;
    const result = await this.ml('/v1/models');
    if (cache.status === 'ready') void cache.set(key, JSON.stringify(result), 'EX', 30).catch(() => undefined);
    return result;
  }

  @Get('monitoring')
  @RequireRoles(PlatformRole.ADMIN)
  async monitoring() {
    const [drift, activity] = await Promise.all([
      this.ml('/v1/drift'),
      this.sustainability.activity(),
    ]);
    return { drift, activity };
  }

  @Get('jobs/:id')
  async job(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) {
    const job = await this.db.intelligenceJob.findFirst({
      where: { id, OR: [{ kind: 'RECOMMENDATION' }, { userId: identity.user.id }] },
      select: jobSummary,
    });
    if (!job) throw new NotFoundException();
    if (job.organizationId) await this.access.require(identity.user.id, job.organizationId);
    return job;
  }

  @Post('forecasts')
  async forecast(@CurrentIdentity() identity: Identity, @Body() dto: ForecastDto) {
    const { kind, organizationId } = dto;
    if (organizationId) await this.access.require(identity.user.id, organizationId);
    if (kind === 'SURPLUS' && !dto.acreage) throw new BadRequestException('Enter the crop acreage');
    if (
      dto.priorHarvestKg != null &&
      dto.priorSurplusKg != null &&
      dto.priorSurplusKg > dto.priorHarvestKg
    ) {
      throw new BadRequestException('Prior surplus cannot exceed prior harvest');
    }
    const crop = dto.crop.trim();
    if (!crop) throw new BadRequestException('Enter a crop');
    const input = Object.fromEntries(
      Object.entries({ ...dto, crop }).filter(
        ([key, value]) => key !== 'kind' && key !== 'organizationId' && value != null,
      ),
    );
    return this.db.intelligenceJob.create({
      data: { kind, organizationId, userId: identity.user.id, input },
      select: jobSummary,
    });
  }

  @Post('classification')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: 3_000_000, files: 1, fields: 3, fieldSize: 12_000 },
    }),
  )
  classify(
    @CurrentIdentity() identity: Identity,
    @Body() dto: ClassificationDto,
    @UploadedFile() photo?: { buffer: Buffer; mimetype: string },
  ) {
    if (photo && (!imageTypes.has(photo.mimetype) || !fileMatchesType(photo.buffer, photo.mimetype)))
      throw new BadRequestException('Choose a JPEG, PNG or WebP photo');
    const crop = dto.crop.trim();
    const symptoms = dto.symptoms.trim();
    if (!crop || symptoms.length < 10)
      throw new BadRequestException('Enter a crop and at least 10 characters of symptoms');
    return this.db.intelligenceJob.create({
      data: {
        kind: 'CLASSIFY',
        userId: identity.user.id,
        input: { crop, symptoms, ...(photo ? { photo: photo.buffer.toString('base64') } : {}) },
      },
      select: jobSummary,
    });
  }

  @Post('issues/:id/similarity')
  async similarity(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) {
    const issue = await this.db.issueReport.findFirst({
      where: { id, author: activeAccount },
      select: { id: true },
    });
    if (!issue) throw new NotFoundException();
    return this.db.intelligenceJob.create({
      data: { kind: 'SIMILARITY', userId: identity.user.id, subjectId: id },
      select: jobSummary,
    });
  }

  @Get('listings/:id/recommendations')
  async recommended(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = await this.listingAccess(id, identity);
    return {
      job: await this.db.intelligenceJob.findFirst({
        where: { subjectId: id, organizationId, kind: 'RECOMMENDATION' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: jobSummary,
      }),
    };
  }

  @Post('listings/:id/recommendations')
  async recommend(@CurrentIdentity() identity: Identity, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = await this.listingAccess(id, identity);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM crop_listings WHERE id = ${id}::uuid FOR UPDATE`;
      const pending = await tx.intelligenceJob.findFirst({
        where: { kind: 'RECOMMENDATION', subjectId: id, status: { in: ['QUEUED', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
        select: jobSummary,
      });
      return (
        pending ??
        tx.intelligenceJob.create({
          data: { kind: 'RECOMMENDATION', organizationId, subjectId: id },
          select: jobSummary,
        })
      );
    });
  }

  private async listingAccess(id: string, identity: Identity) {
    const listing = await this.db.cropListing.findFirst({
      where: { id, deletedAt: null, organization: activeOrganization },
      select: { organizationId: true },
    });
    if (!listing) throw new NotFoundException();
    await this.access.require(identity.user.id, listing.organizationId);
    return listing.organizationId;
  }

  private async ml(path: '/v1/drift' | '/v1/models'): Promise<unknown> {
    try {
      const base = this.config.get<string>('ML_SERVICE_URL') ?? 'http://localhost:8000';
      const response = await fetch(new URL(path, base), {
        signal: AbortSignal.timeout(4000),
        headers: { 'X-CropCircle-ML-Key': this.config.get<string>('ML_SERVICE_KEY') ?? '' },
      });
      if (response.status === 403) throw new ForbiddenException();
      if (!response.ok) throw new Error('Service response error');
      return await response.json();
    } catch {
      throw new ServiceUnavailableException('Model service is unavailable');
    }
  }
}
