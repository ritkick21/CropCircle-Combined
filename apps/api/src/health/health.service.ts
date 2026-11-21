import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DependencyHealth, HealthResponse, ReadinessResponse } from '@cropcircle/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  liveness(): HealthResponse {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessResponse> {
    const [database, postgis, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkPostgis(),
      this.checkRedis(),
    ]);

    const dependencies: Record<string, DependencyHealth> = {
      postgresql: database,
      postgis,
      redis,
    };

    const mlServiceUrl = this.config.get<string>('ML_SERVICE_URL');
    if (mlServiceUrl) {
      dependencies.mlService = await this.checkMlService(mlServiceUrl);
    }

    const requiredReady = [database, postgis, redis].every(
      (dependency) => dependency.status === 'ok',
    );
    const mlReady = dependencies.mlService?.status !== 'degraded';

    return {
      service: 'api',
      status: !requiredReady ? 'unavailable' : mlReady ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  private async checkDatabase(): Promise<DependencyHealth> {
    try {
      await this.prisma.$queryRaw`SELECT 1 AS ok`;
      return { status: 'ok' };
    } catch {
      return { status: 'unavailable', detail: 'database query failed' };
    }
  }

  private async checkPostgis(): Promise<DependencyHealth> {
    try {
      const result = await this.prisma.$queryRaw<Array<{ version: string }>>`
        SELECT PostGIS_Version() AS version
      `;
      if (!result[0]?.version) {
        throw new Error('PostGIS did not report a version');
      }
      return { status: 'ok', detail: result[0].version };
    } catch {
      return { status: 'unavailable', detail: 'PostGIS query failed' };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    try {
      const response = await this.redis.ping();
      if (response !== 'PONG') {
        throw new Error('Redis did not respond with PONG');
      }
      return { status: 'ok' };
    } catch {
      return { status: 'unavailable', detail: 'Redis ping failed' };
    }
  }

  private async checkMlService(baseUrl: string): Promise<DependencyHealth> {
    try {
      const url = new URL('health/ready', `${baseUrl.replace(/\/$/, '')}/`);
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return response.ok
        ? { status: 'ok' }
        : { status: 'degraded', detail: 'ML service is not ready' };
    } catch {
      return { status: 'degraded', detail: 'ML service is unreachable' };
    }
  }
}
