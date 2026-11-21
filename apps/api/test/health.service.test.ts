import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { RedisService } from '../src/redis/redis.service';
import { HealthService } from '../src/health/health.service';

function service(
  options: {
    databaseWorks?: boolean;
    redisWorks?: boolean;
    mlUrl?: string;
  } = {},
): HealthService {
  const prisma = {
    $queryRaw: (strings: TemplateStringsArray): Promise<unknown> => {
      if (options.databaseWorks === false) {
        return Promise.reject(new Error('database offline'));
      }
      return Promise.resolve(
        strings.join('').includes('PostGIS_Version') ? [{ version: '3.5' }] : [{ ok: 1 }],
      );
    },
  } as unknown as PrismaService;
  const redis = {
    ping: (): Promise<string> =>
      Promise.resolve(options.redisWorks === false ? 'NOT_PONG' : 'PONG'),
  } as unknown as RedisService;
  const config = {
    get: (name: string): string | undefined =>
      name === 'ML_SERVICE_URL' ? options.mlUrl : undefined,
  } as unknown as ConfigService;
  return new HealthService(prisma, redis, config);
}

void test('readiness requires PostgreSQL, PostGIS and Redis', async () => {
  const healthy = await service().readiness();
  assert.equal(healthy.status, 'ok');
  assert.equal(healthy.dependencies.postgis?.status, 'ok');

  const databaseDown = await service({ databaseWorks: false }).readiness();
  assert.equal(databaseDown.status, 'unavailable');
  assert.equal(databaseDown.dependencies.postgresql?.status, 'unavailable');

  const redisDown = await service({ redisWorks: false }).readiness();
  assert.equal(redisDown.status, 'unavailable');
  assert.equal(redisDown.dependencies.redis?.status, 'unavailable');
});

void test('liveness does not depend on optional ML service', () => {
  assert.equal(service({ mlUrl: 'http://localhost:8000' }).liveness().status, 'ok');
});
