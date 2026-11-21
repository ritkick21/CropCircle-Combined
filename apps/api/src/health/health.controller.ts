import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthResponse, ReadinessResponse } from '@cropcircle/shared-types';
import { Public } from '../auth/auth.guards';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'API process liveness' })
  live(): HealthResponse {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Database, PostGIS, Redis and optional ML readiness' })
  async ready(): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    if (result.status === 'unavailable') {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
