import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LocationsService } from '../src/locations/locations.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { LocationQueryDto } from '../src/locations/locations.dto';

void test('nearby search rejects missing coordinates before querying the database', async () => {
  const db = {
    $queryRaw: () => {
      throw new Error('database should not be called');
    },
  } as unknown as PrismaService;
  const service = new LocationsService(db);
  await assert.rejects(
    service.list(new LocationQueryDto(), '00000000-0000-0000-0000-000000000000', true),
    BadRequestException,
  );
});

void test('location creation requires active manager membership', async () => {
  const db = {
    organizationMembership: { findFirst: () => Promise.resolve(null) },
  } as unknown as PrismaService;
  const service = new LocationsService(db);
  await assert.rejects(
    service.create('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', {
      category: 'FOOD_BANK',
      name: 'Test',
      lng: 0,
      lat: 0,
    }),
    ForbiddenException,
  );
});
