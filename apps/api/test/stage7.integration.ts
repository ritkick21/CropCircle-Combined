import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { PrismaClient, type PlatformRole } from '@prisma/client';
import { hashPassword } from '../src/auth/credentials';

const base = process.env.STAGE7_API_URL ?? 'http://localhost:3001/api/v1';
const db = new PrismaClient();
const nonce = randomUUID().slice(0, 8);
const password = randomUUID();
const harvestDate = new Date().toISOString().slice(0, 10);
const future = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
type Fixture = {
  id: string;
  email: string;
  organizationId: string;
  locationId: string;
  token: string;
};
type Identified = { id: string };
type CompletedPlan = {
  allocated: number;
  unallocated: number;
  available: number;
  recommendations: unknown[];
  dropoffRoute: unknown[];
  dropoffRouteKm: number;
  separateDropoffTripsKm: number;
};
type Metrics = {
  totals: { redistributedKg: number; activeListings: number };
  wasteEstimate: { kg: number };
  fulfillment: { mode: string; fulfilled: number }[];
  demand: { pendingKg: number }[];
  destinations: { name: string }[];
};
type Job<T> = { status: string; modelVersion: string; output: T };

async function request<T = unknown>(
  path: string,
  token = '',
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  expected?: number,
): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (expected) assert.equal(response.status, expected, JSON.stringify(result));
  else assert.ok(response.ok, path + ' · ' + response.status + ' · ' + JSON.stringify(result));
  return result as T;
}

async function finish<T>(token: string, id: string) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const job = await request<Job<T>>('/intelligence/jobs/' + id, token);
    if (job.status === 'COMPLETE') return job;
    assert.notEqual(job.status, 'FAILED', JSON.stringify(job));
    await setTimeout(500);
  }
  throw new Error('Worker did not complete ' + id);
}

async function fixture(
  label: string,
  index: number,
  passwordHash: string,
  roles: PlatformRole[] = ['USER'],
): Promise<Fixture> {
  const email = 'stage7-' + nonce + '-' + index + '@example.invalid';
  const user = await db.user.create({
    data: {
      email,
      displayName: label,
      roles,
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const organization = await db.organization.create({
    data: {
      name: label,
      type: roles.includes('FARMER') ? 'farm' : 'food_bank',
      verifiedAt: new Date(),
      memberships: { create: { userId: user.id, role: 'OWNER' } },
    },
  });
  const locationId = randomUUID();
  await db.$executeRaw`INSERT INTO resource_locations
    (id, organization_id, category, name, public_geog, verified_at, published_at, updated_at)
    VALUES (${locationId}::uuid, ${organization.id}::uuid, 'FOOD_BANK', ${label},
      ST_SetSRID(ST_MakePoint(${-74 + index * 0.015}, ${40.7 + index * 0.01}),4326)::geography, now(), now(), now())`;
  const session = await request<{ accessToken: string }>('/auth/login', '', { email, password });
  return {
    id: user.id,
    email,
    organizationId: organization.id,
    locationId,
    token: session.accessToken,
  };
}

async function main() {
  await db.$connect();
  try {
    const hash = await hashPassword(password);
    const farm = await fixture('Demo Orchard', 0, hash, ['USER', 'FARMER']);
    const bank = await fixture('Demo Food Bank', 1, hash);
    const pantry = await fixture('Demo Community Pantry', 2, hash);
    const admin = await fixture('Demo Administrator', 3, hash, ['USER', 'ADMIN']);
    const cropName = 'Demo Apple ' + nonce;
    for (const [person, limit] of [
      [bank, 45],
      [pantry, 35],
    ] as const) {
      await request(
        '/marketplace/organizations/' + person.organizationId + '/profile',
        person.token,
        {
          locationId: person.locationId,
          acceptedCrops: [cropName],
          demand: cropName,
          quantityLimit: limit,
          storageCapacity: limit,
          serviceRadiusKm: 30,
          pickup: false,
          delivery: true,
          coldStorage: true,
          acceptsSales: true,
        },
        'PUT',
      );
    }
    const publish = (mode: 'SALE' | 'DONATION', quantity: number) =>
      request<Identified>('/marketplace/listings', farm.token, {
        organizationId: farm.organizationId,
        locationId: farm.locationId,
        cropName,
        quantity,
        unit: 'KG',
        harvestDate,
        quality: 'Good',
        storageConditions: 'Cold room',
        requiresColdStorage: true,
        shelfLifeDays: 4,
        pickupAvailability: 'Daytime',
        pickupFrom: future(0.25),
        pickupUntil: future(20),
        expiresAt: future(24),
        mode,
        ...(mode === 'SALE' ? { price: 1.5 } : {}),
      });
    const listing = await publish('DONATION', 100);
    const recommendationPath = '/intelligence/listings/' + listing.id + '/recommendations';
    const initial = await request<{ job: Identified | null }>(recommendationPath, farm.token);
    assert.ok(initial.job, 'publishing enqueues a recommendation atomically');
    await request(recommendationPath, bank.token, undefined, 'GET', 403);
    const recommendation = await finish<CompletedPlan>(farm.token, initial.job.id);
    const plan = recommendation.output;
    assert.equal(plan.allocated, 80);
    assert.equal(plan.unallocated, 20);
    assert.equal(plan.recommendations.length, 2);
    assert.equal(plan.dropoffRoute.length, 2);
    assert.ok(plan.dropoffRouteKm < plan.separateDropoffTripsKm);
    assert.equal(recommendation.modelVersion, 'allocation-1');

    async function receive(
      item: { id: string },
      recipient: Fixture,
      quantity: number,
      fulfill: boolean,
    ) {
      const order = await request<Identified>(
        '/marketplace/listings/' + item.id + '/requests',
        recipient.token,
        {
          organizationId: recipient.organizationId,
          quantity,
        },
      );
      if (fulfill) {
        await request('/marketplace/requests/' + order.id + '/accept', farm.token, {
          pickupAt: future(2),
        });
        await request('/marketplace/requests/' + order.id + '/fulfill', farm.token, {});
      }
    }
    await receive(listing, bank, 20, true);
    await receive(listing, pantry, 15, false);
    const sale = await publish('SALE', 20);
    await receive(sale, bank, 10, true);
    const refreshed = await request<Identified>(recommendationPath, farm.token, {});
    assert.equal((await finish<CompletedPlan>(farm.token, refreshed.id)).output.available, 80);
    const farmOverview = await request<Metrics>('/intelligence/dashboard?scope=farmer', farm.token);
    assert.equal(farmOverview.totals.redistributedKg, 30);
    assert.equal(farmOverview.wasteEstimate.kg, 15);
    assert.equal(farmOverview.totals.activeListings, 2);
    assert.equal(farmOverview.fulfillment.find((row) => row.mode === 'SALE')?.fulfilled, 1);
    assert.equal(farmOverview.demand[0]?.pendingKg, 15);
    assert.equal(farmOverview.destinations[0]?.name, 'Demo Food Bank');
    const recipientOverview = await request<Metrics>(
      '/intelligence/dashboard?scope=organization&organizationId=' + bank.organizationId,
      bank.token,
    );
    assert.equal(recipientOverview.totals.redistributedKg, 30);
    await request(
      '/intelligence/dashboard?scope=organization&organizationId=' + bank.organizationId,
      farm.token,
      undefined,
      'GET',
      403,
    );
    await request('/intelligence/dashboard?scope=admin', farm.token, undefined, 'GET', 403);

    const inventory = await request<{ runId: string; version: string }>(
      '/intelligence/models',
      farm.token,
    );
    assert.ok(inventory.runId);
    const surplus = await request<Identified>('/intelligence/forecasts', farm.token, {
      kind: 'SURPLUS',
      crop: 'apple',
      acreage: 5,
    });
    const projection = await finish<{ low: number; estimate: number; high: number }>(
      farm.token,
      surplus.id,
    );
    assert.equal(projection.modelVersion, inventory.version);
    assert.ok(
      projection.output.low <= projection.output.estimate &&
        projection.output.estimate <= projection.output.high,
    );
    await request('/intelligence/jobs/' + surplus.id, bank.token, undefined, 'GET', 404);
    const demand = await request<Identified>('/intelligence/forecasts', bank.token, {
      kind: 'DEMAND',
      crop: 'apple',
      organizationId: bank.organizationId,
    });
    assert.match(
      (await finish<{ source: string }>(bank.token, demand.id)).output.source,
      /USDA.*proxy/,
    );

    const photo = new FormData();
    photo.set('crop', 'apple');
    photo.set(
      'symptoms',
      'Dark brown lesions with yellow margins on the undersides of the leaves.',
    );
    photo.set(
      'photo',
      new Blob(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4cAAAAASUVORK5CYII=',
            'base64',
          ),
        ],
        { type: 'image/png' },
      ),
      'leaf.png',
    );
    const classification = await request<Identified>(
      '/intelligence/classification',
      farm.token,
      photo,
    );
    const hypothesis = await finish<{ photoAnalyzed: boolean }>(farm.token, classification.id);
    assert.equal(hypothesis.output.photoAnalyzed, true);
    const logged = await db.intelligenceJob.findUniqueOrThrow({ where: { id: classification.id } });
    assert.deepEqual(logged.input, {});

    // Hold crop and category apart to prove this path can surface a semantic match.
    const issue = (author: Fixture, cropType: string, category: string) =>
      request<Identified>('/collaboration/issues', author.token, {
        cropType,
        category,
        title: cropType + ' leaf observations',
        region: 'Demo county',
        observedAt: harvestDate,
        publicLat: 40.7,
        publicLng: -74,
        symptoms: 'Dark brown lesions on leaves with pale yellow spots on the undersides.',
      });
    const a = await issue(farm, 'Apple', 'DISEASE');
    const b = await issue(admin, 'Pear', 'PEST');
    const match = await request<Identified>(
      '/intelligence/issues/' + a.id + '/similarity',
      farm.token,
      {},
    );
    const peers = await finish<{ matches: { reportId: string }[] }>(farm.token, match.id);
    assert.ok(peers.output.matches.some((row) => row.reportId === b.id));
    const conversation = await request<{ peer: Identified }>(
      '/realtime/conversations',
      farm.token,
      {
        issueId: a.id,
        matchedIssueId: b.id,
      },
    );
    assert.equal(conversation.peer.id, admin.id);
    const monitor = await request<{
      activity: { kind: string; status: string }[];
      drift: { features: unknown[] };
    }>('/intelligence/monitoring', admin.token);
    assert.ok(monitor.activity.some((row) => row.kind === 'CLASSIFY' && row.status === 'COMPLETE'));
    assert.ok(monitor.drift.features.length > 0);
    assert.ok(
      (await request<Metrics>('/intelligence/dashboard?scope=admin', admin.token)).totals
        .redistributedKg >= 30,
    );
    console.log(
      'Stage 7 integration passed for allocations, forecasts, classification, similarity and scoped analytics',
    );
    if (process.env.STAGE7_FIXTURE_PATH) {
      await writeFile(
        process.env.STAGE7_FIXTURE_PATH,
        JSON.stringify({
          farm: farm.email,
          bank: bank.email,
          admin: admin.email,
          password,
          listingId: listing.id,
          cropName,
        }),
        { mode: 0o600 },
      );
    }
  } finally {
    await db.$disconnect();
  }
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
