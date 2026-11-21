import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/credentials';

const db = new PrismaService();
const file = 'test/.stage5-browser-fixture.json';
async function run() {
  await db.$connect();
  try {
    if (process.argv[2] === 'cleanup') {
      const fixture = JSON.parse(readFileSync(file, 'utf8')) as { users: string[]; organizations: string[]; locations: string[] };
      await db.groupPost.deleteMany({ where: { authorId: { in: fixture.users } } });
      await db.groupObservation.deleteMany({ where: { authorId: { in: fixture.users } } });
      await db.groupInvitation.deleteMany({ where: { OR: [{ invitedId: { in: fixture.users } }, { invitedById: { in: fixture.users } }] } });
      await db.groupMembership.deleteMany({ where: { userId: { in: fixture.users } } });
      await db.researchGroup.deleteMany({ where: { creatorId: { in: fixture.users } } });
      await db.issueReport.deleteMany({ where: { authorId: { in: fixture.users } } });
      await db.marketplaceRequest.deleteMany({ where: { organizationId: { in: fixture.organizations } } });
      await db.cropListing.deleteMany({ where: { organizationId: { in: fixture.organizations } } });
      await db.marketplaceProfile.deleteMany({ where: { organizationId: { in: fixture.organizations } } });
      await db.resourceLocation.deleteMany({ where: { id: { in: fixture.locations } } });
      await db.authSession.deleteMany({ where: { userId: { in: fixture.users } } });
      await db.organizationMembership.deleteMany({ where: { organizationId: { in: fixture.organizations } } });
      await db.organization.deleteMany({ where: { id: { in: fixture.organizations } } });
      await db.user.deleteMany({ where: { id: { in: fixture.users } } });
      unlinkSync(file);
      console.log('Browser fixture cleaned up');
      return;
    }
    const nonce = randomUUID();
    const password = randomBytes(20).toString('base64url');
    const users: string[] = [], organizations: string[] = [], locations: string[] = [];
    for (let i=0; i<2; i++) {
      const user = await db.user.create({ data: { email: `stage5-browser-${nonce}-${i}@example.invalid`, displayName: i ? 'Demo Recipient' : 'Demo Farmer', passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), status: 'ACTIVE', roles: i ? ['USER'] : ['USER','FARMER','ADMIN'] } });
      users.push(user.id);
      const org = await db.organization.create({ data: { name: i ? 'Demo Food Bank' : 'Demo Farm', type: i ? 'food_bank' : 'farm', verifiedAt: new Date(), memberships: { create: { userId: user.id, role: 'OWNER' } } } });
      organizations.push(org.id);
      const locationId = randomUUID();
      await db.$executeRaw`INSERT INTO resource_locations (id, organization_id, category, name, public_geog, verified_at, published_at, updated_at) VALUES (${locationId}::uuid, ${org.id}::uuid, ${i ? 'FOOD_BANK' : 'FARMER'}::"ResourceCategory", ${i ? 'Demo Food Bank pickup' : 'Demo Farm pickup'}, ST_SetSRID(ST_MakePoint(${-73.9 + i*0.1},${40.7 + i*0.1}),4326)::geography, now(), now(), now())`;
      locations.push(locationId);
    }
    writeFileSync(file, JSON.stringify({ users, organizations, locations }));
    console.log(JSON.stringify({ farmerEmail: `stage5-browser-${nonce}-0@example.invalid`, buyerEmail: `stage5-browser-${nonce}-1@example.invalid`, password }));
  } finally { await db.$disconnect(); }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
