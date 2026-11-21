// Run against a disposable/local PostGIS database with DATABASE_URL set.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { LocationsService } from '../src/locations/locations.service';
import { LocationQueryDto } from '../src/locations/locations.dto';

const db = new PrismaService();
const rollback = new Error('rollback integration fixture');

async function run() {
  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: `map-${randomUUID()}@example.invalid`, displayName: 'Map fixture', status: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash: 'integration-fixture' } });
      const organization = await tx.organization.create({ data: { name: 'Map integration fixture', type: 'food_bank', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
      const name = 'Integration food bank ' + randomUUID();
      const transactionalDb = new Proxy(tx, { get(target, property, receiver) { if (property === '$transaction') return (callback: (client: typeof tx) => Promise<unknown>) => callback(tx); return Reflect.get(target, property, receiver) as unknown; } }) as unknown as PrismaService;
      const service = new LocationsService(transactionalDb);
      const created = await service.create(organization.id, user.id, { category: 'FOOD_BANK', name, lng: -75, lat: 40, acceptedCrops: ['apple'], capacityKg: 500 });
      const query = Object.assign(new LocationQueryDto(), { q: name, lat: 40, lng: -75, radiusKm: 5 });
      assert.equal((await service.list(query, user.id, true)).total, 0, 'draft must not be discoverable');
      assert.equal((await service.get(created.id, user.id)).id, created.id, 'owner may inspect draft');
      await service.publish(created.id, user.id, 'Verified public food bank office');
      assert.equal(await tx.resourceLocationReview.count({ where: { locationId: created.id, reviewerId: user.id } }), 1);
      const result = await service.list(query, user.id, true);
      assert.equal(result.total, 1);
      assert.equal(result.items[0]?.name, name);
      assert.equal(Math.round(result.items[0]?.distanceMeters ?? -1), 0);
      assert.equal((await service.list(Object.assign(new LocationQueryDto(), { q: name, crop: 'apple' }), user.id)).total, 1);
      assert.equal((await service.list(Object.assign(new LocationQueryDto(), { q: name, crop: 'pear' }), user.id)).total, 0);
      assert.equal((await service.list(Object.assign(new LocationQueryDto(), { q: name, category: 'FARMER' }), user.id)).total, 0);
      const markers = await service.markers({ q: name, west: -76, east: -74, south: 39, north: 41, zoom: 8, limit: 30, offset: 0 }, user.id);
      assert.equal(markers.total, 1);
      assert.equal(markers.items.length, 1);
      assert.equal((await service.markers({ q: name, west: -76, east: -74, south: 39, north: 41, zoom: 8, limit: 1, offset: 1 }, user.id)).items.length, 0);
      assert.equal((await service.markers({ q: name, west: -180, east: 180, south: -90, north: 90, zoom: 0, limit: 1, offset: 0 }, user.id)).items[0]?.id, created.id);
      await service.update(created.id, user.id, { capacityKg: 300, hours: { mon: '09:00-17:00' } });
      assert.equal((await service.get(created.id, user.id)).capacityKg, 300);
      assert.equal((await service.list(query, user.id, true)).total, 1);
      await service.update(created.id, user.id, { name: name + ' updated' });
      assert.equal((await service.list(query, user.id, true)).total, 0, 'public identity change requires renewed review');
      const farmer = await service.create(organization.id, user.id, { category: 'FARMER', name: 'Coarse farm', lng: -75.047, lat: 40.047, addressLabel: 'Private home' });
      const farmerDetail = await service.get(farmer.id, user.id);
      assert.equal(farmerDetail.lng, -75);
      assert.equal(farmerDetail.lat, 40);
      assert.equal(farmerDetail.addressLabel, null);
      const dateline = await service.create(organization.id, user.id, { category: 'FOOD_BANK', name: 'Dateline fixture', lng: 179.8, lat: 0 });
      await service.publish(dateline.id, user.id, 'Public dateline office verified');
      const crossing = await service.markers({ west: 179, east: -179, south: -1, north: 1, zoom: 8, limit: 30, offset: 0 }, user.id);
      assert.equal(crossing.items.some((marker) => marker.id === dateline.id), true);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
