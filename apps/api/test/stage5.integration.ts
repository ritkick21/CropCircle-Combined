import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrganizationAccessService } from '../src/organizations/organization-access.service';
import { MarketplaceService } from '../src/stage5/marketplace.service';
import { CollaborationService } from '../src/stage5/collaboration.service';
import { MediaService } from '../src/stage5/media.service';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

async function main() {
  const db = new PrismaService();
  await db.$connect();
  const access = new OrganizationAccessService(db);
  const market = new MarketplaceService(db, access);
  const collaboration = new CollaborationService(db);
  const media = new MediaService(db);
  const nonce = randomUUID();
  const userIds: string[] = [], orgIds: string[] = [], listingIds: string[] = [], requestIds: string[] = [], groupIds: string[] = [];
  let uploadedKey = '';
  try {
    for (let i=0; i<3; i++) {
      const user = await db.user.create({ data: { email: `stage5-${nonce}-${i}@example.invalid`, displayName: `Fixture ${i}`, passwordHash: 'fixture-only-hash', emailVerifiedAt: new Date(), status: 'ACTIVE', roles: ['USER', ...(i===0 ? ['FARMER' as const] : [])] } });
      userIds.push(user.id);
      const org = await db.organization.create({ data: { name: `Fixture org ${i}`, type: i===0 ? 'farm' : 'food_bank', verifiedAt: new Date(), memberships: { create: { userId: user.id, role: 'OWNER' } } } });
      orgIds.push(org.id);
    }
    const locationId = randomUUID();
    await db.$executeRaw`INSERT INTO resource_locations (id, organization_id, category, name, public_geog, verified_at, published_at, updated_at) VALUES (${locationId}::uuid, ${orgIds[0]}::uuid, 'FARMER'::"ResourceCategory", 'Public pickup fixture', ST_SetSRID(ST_MakePoint(-73.9, 40.7),4326)::geography, now(), now(), now())`;
    const recipientLocationId = randomUUID();
    await db.$executeRaw`INSERT INTO resource_locations (id, organization_id, category, name, public_geog, verified_at, published_at, updated_at) VALUES (${recipientLocationId}::uuid, ${orgIds[1]}::uuid, 'FOOD_BANK'::"ResourceCategory", 'Public recipient fixture', ST_SetSRID(ST_MakePoint(-73.8, 40.8),4326)::geography, now(), now(), now())`;
    await market.upsertProfile(userIds[1], orgIds[1], { locationId: recipientLocationId, acceptedCrops: ['Tomato'], demand: 'Fresh tomatoes', quantityLimit: 20, storageCapacity: 100, serviceRadiusKm: 50, pickup: true, delivery: false });
    assert.ok((await market.recipientMarkers({ limit: 30, offset: 0 })).some(item => item.organizationName === 'Fixture org 1'));
    const listing = await market.create(userIds[0], ['FARMER'], { organizationId: orgIds[0], locationId, cropName: 'Tomato', quantity: 10, unit: 'KG', harvestDate: '2026-11-21', quality: 'Good', storageConditions: 'Cool', shelfLifeDays: 7, pickupAvailability: 'Weekdays', mode: 'DONATION', expiresAt: new Date(Date.now()+86400000).toISOString() });
    listingIds.push(listing.id);
    const found = await market.list({ q: 'tomato', limit: 30, offset: 0 });
    assert.ok(found.items.some(item => item.id === listing.id));
    const map = await market.markers({ limit: 30, offset: 0 });
    assert.ok(map.items.some(item => item.id === listing.id && Math.abs(item.lat-40.7) < 0.001));
    const a = await market.request(userIds[1], listing.id, { organizationId: orgIds[1], quantity: 7 });
    const b = await market.request(userIds[2], listing.id, { organizationId: orgIds[2], quantity: 7 });
    requestIds.push(a.id,b.id);
    const pickupAt = new Date(Date.now()+3600000).toISOString();
    const outcomes = await Promise.allSettled([market.transition(userIds[0], a.id, 'accept', { pickupAt }), market.transition(userIds[0], b.id, 'accept', { pickupAt })]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1, 'one partial reservation succeeds');
    assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1, 'overbooking is rejected');
    const accepted = outcomes[0].status === 'fulfilled' ? a : b;
    const current = await db.cropListing.findUniqueOrThrow({ where: { id: listing.id } });
    assert.equal(Number(current.reservedQuantity), 7);
    await market.transition(userIds[0], accepted.id, 'fulfill');
    const final = await db.cropListing.findUniqueOrThrow({ where: { id: listing.id } });
    assert.equal(Number(final.quantity), 3);
    assert.equal(Number(final.reservedQuantity), 0);
    const next = await market.request(userIds[1], listing.id, { organizationId: orgIds[1], quantity: 2 });
    requestIds.push(next.id);
    await market.transition(userIds[0], next.id, 'accept', { pickupAt });
    await market.transition(userIds[1], next.id, 'cancel');
    assert.equal(Number((await db.cropListing.findUniqueOrThrow({ where: { id: listing.id } })).reservedQuantity), 0);
    if (process.env.S3_PUBLIC_ENDPOINT) {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=', 'base64');
      const uploaded = await media.upload(userIds[0], { buffer: png, mimetype: 'image/png' });
      uploadedKey = uploaded.key;
      await assert.rejects(media.view(userIds[1], uploadedKey), { status: 403 });
    }
    const report = await collaboration.createIssue(userIds[0], ['FARMER'], { cropType: 'Tomato', category: 'PEST', title: 'Leaf spots', symptoms: 'Spots observed across lower leaves', region: 'Test county', observedAt: '2026-11-21', interests: ['tomato'], imageKeys: uploadedKey ? [uploadedKey] : [] });
    if (uploadedKey) {
      const viewed = await media.view(userIds[1], uploadedKey);
      assert.equal((await fetch(viewed.url)).status, 200);
    }
    assert.equal((await collaboration.issues({ limit: 30, offset: 0, cropType: 'Tomato' })).items.find(item => item.id === report.id)?.diagnosisStatus, 'UNVERIFIED');
    const group = await collaboration.createGroup(userIds[0], ['FARMER'], { name: 'Tomato trials', description: 'Fixture group', cropTypes: ['Tomato'], interests: ['pests'] });
    groupIds.push(group.id);
    await collaboration.invite(userIds[0], group.id, { userId: userIds[1] });
    const invitation = (await collaboration.invitations(userIds[1]))[0];
    await collaboration.invitationDecision(userIds[1], invitation.id, true);
    await collaboration.post(userIds[1], group.id, { body: 'Field notes shared' });
    await collaboration.observe(userIds[0], group.id, { title: 'Trial A', method: 'Compare two beds', observation: 'One bed has fewer spots', observedAt: '2026-11-21' });
    const detail = await collaboration.group(userIds[1], group.id);
    assert.equal(detail.posts.length, 1);
    assert.equal(detail.observations.length, 1);
    console.log('Stage 5 integration passed: listing/map, concurrent reservation, fulfillment, report, invitation and group content');
    await db.issueReport.delete({ where: { id: report.id } });
  } finally {
    for (const id of groupIds) {
      await db.groupPost.deleteMany({ where: { groupId: id } });
      await db.groupObservation.deleteMany({ where: { groupId: id } });
      await db.groupInvitation.deleteMany({ where: { groupId: id } });
      await db.groupMembership.deleteMany({ where: { groupId: id } });
      await db.researchGroup.delete({ where: { id } });
    }
    await db.marketplaceRequest.deleteMany({ where: { id: { in: requestIds } } });
    await db.cropListing.deleteMany({ where: { id: { in: listingIds } } });
    await db.marketplaceProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.$executeRaw`DELETE FROM resource_locations WHERE organization_id = ${orgIds[0]}::uuid AND name = 'Public pickup fixture'`;
    await db.$executeRaw`DELETE FROM resource_locations WHERE organization_id = ${orgIds[1]}::uuid AND name = 'Public recipient fixture'`;
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (uploadedKey) {
      const storage = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } });
      await storage.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: uploadedKey }));
      storage.destroy();
    }
    await db.$disconnect();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
