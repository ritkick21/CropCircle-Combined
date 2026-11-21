import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const api = process.env.AUTH_TEST_API_URL ?? 'http://localhost:3001/api/v1';
const mail = process.env.AUTH_TEST_MAIL_URL ?? 'http://127.0.0.1:8025';
const password = 'Garden apples grow on trees!';
const replacement = 'New garden carrots grow underground!';
const run = randomUUID();
const emails = ['owner', 'manager', 'member', 'outsider', 'missing'].map(
  (label) => `${label}.${run}@cropcircle.test`,
);
const [owner, manager, member, outsider, missing] = emails;

async function request(path, status, { body, access, cookie, method, origin } = {}) {
  const response = await fetch(api + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const expected = Array.isArray(status) ? status : [status];
  assert.ok(
    expected.includes(response.status),
    `${path} returned HTTP ${response.status}, expected ${expected.join(' or ')}`,
  );
  return response;
}

async function codeFor(email, subject, seen = new Set()) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const inbox = await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    assert.equal(inbox.status, 200);
    const { messages } = await inbox.json();
    const newest = (messages ?? []).find(
      (message) => message.Subject === subject && !seen.has(message.ID),
    );
    if (newest) {
      const response = await fetch(`${mail}/api/v1/message/${newest.ID}`);
      assert.equal(response.status, 200);
      const { Text } = await response.json();
      const code = Text.match(/^([A-Za-z0-9_-]{43})\s*$/m)?.[1];
      assert.ok(code, 'Mailpit message should contain a code');
      seen.add(newest.ID);
      return code;
    }
    await delay(100);
  }
  assert.fail(`Mailpit did not receive ${subject}`);
}

async function signup(email) {
  await request('/auth/registrations', 202, { body: { email } });
  const token = await codeFor(email.toLowerCase(), 'Verify your CropCircle email');
  return { token, displayName: 'Garden volunteer', password };
}

async function login(email, candidate = password) {
  const response = await request('/auth/login', 200, { body: { email, password: candidate } });
  const header = response.headers.get('set-cookie');
  assert.ok(header?.includes('HttpOnly') && header.includes('SameSite=Strict'));
  assert.match(header, /Path=\/api\/v1\/auth/);
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload).sort(), ['accessToken', 'expiresIn', 'tokenType']);
  assert.equal(payload.expiresIn, 600);
  assert.equal(payload.tokenType, 'Bearer');
  return { access: payload.accessToken, cookie: header.split(';')[0] };
}

void test(
  'identity and organization APIs against PostgreSQL/PostGIS, Redis and SMTP',
  { timeout: 60000 },
  async (t) => {
    assert.ok(process.env.DATABASE_URL, 'Set DATABASE_URL to the integration API database');
    const db = new PrismaClient();
    const organizationIds = [];
    let ownerSession;
    let managerSession;
    let memberSession;
    let outsiderSession;
    let memberId;
    let organizationPath;
    let farmId;

    t.after(async () => {
      try {
        await db.site.deleteMany({ where: { organizationId: { in: organizationIds } } });
        await db.organizationMembership.deleteMany({
          where: { organizationId: { in: organizationIds } },
        });
        await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
        await db.user.deleteMany({ where: { email: { in: emails } } });
      } finally {
        await db.$disconnect();
      }
    });

    await t.test('registration, verification and scoped rotation', async () => {
      await request('/health/live', 200);
      await request('/auth/me', 401);
      await request('/auth/registrations', 400, { body: { email: owner, roles: ['ADMIN'] } });
      const verification = await signup(owner.toUpperCase());
      await request('/auth/login', 401, { body: { email: owner, password } });

      const pending = await db.user.findUniqueOrThrow({ where: { email: owner } });
      assert.equal(pending.passwordHash, null);
      const storedToken = await db.authToken.findFirstOrThrow({ where: { userId: pending.id } });
      assert.equal(
        storedToken.tokenHash,
        createHash('sha256').update(verification.token).digest('hex'),
      );
      for (const email of [manager, member, outsider]) {
        const input = await signup(email);
        await request('/auth/email-verification', 204, { body: input });
      }
      const verify = () => request('/auth/email-verification', [204, 400], { body: verification });
      const verificationStatuses = (await Promise.all([verify(), verify()])).map(
        (response) => response.status,
      );
      assert.deepEqual(verificationStatuses.sort(), [204, 400]);

      const user = await db.user.findUniqueOrThrow({ where: { email: owner } });
      assert.match(user.passwordHash, /^scrypt-v1\$/);
      assert.deepEqual(user.roles, ['USER']);
      await request('/auth/login', 401, { body: { email: owner, password: 'Incorrect password' } });
      const first = await login(owner);
      await request('/auth/refresh', 403, {
        ...first,
        method: 'POST',
        origin: 'https://untrusted.example',
      });
      const rotate = () => request('/auth/refresh', [200, 401], { ...first, method: 'POST' });
      const rotations = await Promise.all([rotate(), rotate()]);
      assert.deepEqual(rotations.map((response) => response.status).sort(), [200, 401]);
      const rotated = rotations.find((response) => response.ok);
      ownerSession = {
        access: (await rotated.json()).accessToken,
        cookie: rotated.headers.get('set-cookie').split(';')[0],
      };
      assert.notEqual(first.cookie, ownerSession.cookie);
      await request('/auth/refresh', 401, { ...first, method: 'POST' });
      const me = await (await request('/auth/me', 200, ownerSession)).json();
      assert.equal(me.email, owner);
      assert.deepEqual(Object.keys(me).sort(), [
        'displayName',
        'email',
        'emailVerifiedAt',
        'id',
        'roles',
      ]);
      const refresh = ownerSession.cookie.split('=')[1];
      const session = await db.authSession.findFirstOrThrow({ where: { userId: user.id } });
      assert.equal(session.refreshHash, createHash('sha256').update(refresh).digest('hex'));
    });

    await t.test('multiple memberships, role boundaries, and private locations', async () => {
      assert.ok(ownerSession, 'Registration scenario must pass first');
      managerSession = await login(manager);
      memberSession = await login(member);
      outsiderSession = await login(outsider);
      memberId = (await (await request('/auth/me', 200, memberSession)).json()).id;
      const makeOrganization = async (name) => {
        const response = await request('/organizations', 201, {
          ...ownerSession,
          body: { name, type: 'farm' },
        });
        const { id } = await response.json();
        organizationIds.push(id);
        return id;
      };
      farmId = await makeOrganization('Private farm');
      const secondId = await makeOrganization('Second farm');
      organizationPath = `/organizations/${farmId}`;

      const privateSite = await db.site.create({
        data: { organizationId: farmId, name: `PRIVATE ADDRESS ${run}` },
      });
      await db.$executeRaw`UPDATE sites SET exact_geog = ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography WHERE id = ${privateSite.id}::uuid`;
      const organization = await (await request(organizationPath, 200, ownerSession)).json();
      assert.deepEqual(Object.keys(organization).sort(), [
        'createdAt',
        'id',
        'name',
        'type',
        'updatedAt',
        'verifiedAt',
      ]);
      assert.equal(organization.verifiedAt, null);
      const verificationPath = `/marketplace/organizations/${farmId}/verify`;
      await request(verificationPath, 403, { ...ownerSession, method: 'POST' });
      await db.user.update({ where: { email: manager }, data: { roles: ['USER', 'ADMIN'] } });
      const verified = await request(verificationPath, 201, { ...managerSession, method: 'POST' });
      assert.ok((await verified.json()).verifiedAt);
      await db.user.update({ where: { email: manager }, data: { roles: ['USER'] } });
      await request(organizationPath, 403, outsiderSession);
      await request('/organizations/invalid', 400, ownerSession);

      const invite = async (session, id, email, role, status = 202) => {
        await request(`/organizations/${id}/invitations`, status, {
          ...session,
          body: { email, role },
        });
        if (status === 202)
          return codeFor(email, 'CropCircle organization invitation', seenInvites);
      };
      const seenInvites = new Set();
      const accept = (session, token, status = 200) =>
        request('/organizations/invitations/accept', status, { ...session, body: { token } });
      const managerInvite = await invite(ownerSession, farmId, manager, 'MANAGER');
      await accept(outsiderSession, managerInvite, 400);
      await accept(managerSession, managerInvite);
      await accept(managerSession, managerInvite, 400);
      await invite(managerSession, farmId, outsider, 'MANAGER', 403);
      await invite(ownerSession, farmId, outsider, 'OWNER', 400);

      const memberInvite = await invite(managerSession, farmId, member, 'MEMBER');
      const memberMembership = await (await accept(memberSession, memberInvite)).json();
      const secondInvite = await invite(ownerSession, secondId, member, 'MEMBER');
      await accept(memberSession, secondInvite);
      const memberships = await (await request('/organizations', 200, memberSession)).json();
      assert.deepEqual(new Set(memberships.map(({ id }) => id)), new Set([farmId, secondId]));
      assert.ok(memberships.every(({ membershipRole }) => membershipRole === 'MEMBER'));
      await request(`${organizationPath}/members`, 403, memberSession);
      const roster = await (
        await request(`${organizationPath}/members`, 200, managerSession)
      ).json();
      const ownerMembership = roster.find(({ role }) => role === 'OWNER');
      assert.deepEqual(Object.keys(ownerMembership.user).sort(), ['displayName', 'id']);
      await request(`${organizationPath}/members/${ownerMembership.id}`, 403, {
        ...managerSession,
        method: 'DELETE',
      });
      await request(`/organizations/${secondId}/members/${memberMembership.id}`, 404, {
        ...ownerSession,
        method: 'DELETE',
      });
      await request(`${organizationPath}/members/${memberMembership.id}`, 204, {
        ...managerSession,
        method: 'DELETE',
      });
      await request(organizationPath, 403, memberSession);
      await request(`/organizations/${secondId}`, 200, memberSession);

      await db.user.update({ where: { id: memberId }, data: { roles: ['FARMER'] } });
      await request(`/organizations/${secondId}`, 403, memberSession);
      await db.user.update({ where: { id: memberId }, data: { roles: ['USER'] } });
      await db.organization.update({ where: { id: secondId }, data: { suspendedAt: new Date() } });
      await request(`/organizations/${secondId}`, 403, memberSession);
    });

    await t.test('password reset, logout, expiry and rate limits', async () => {
      assert.ok(ownerSession && outsiderSession, 'Earlier registration scenarios must pass first');
      const recover = (email) => request('/auth/password-recovery', 202, { body: { email } });
      assert.equal(await (await recover(missing)).text(), await (await recover(owner)).text());
      const code = await codeFor(owner, 'Reset your CropCircle password');
      const reset = () =>
        request('/auth/password-reset', [204, 400], {
          body: { token: code, password: replacement },
        });
      const resets = await Promise.all([reset(), reset()]);
      assert.deepEqual(resets.map((response) => response.status).sort(), [204, 400]);
      await request('/auth/me', 401, ownerSession);
      await request('/auth/refresh', 401, { ...ownerSession, method: 'POST' });
      await request('/auth/login', 401, { body: { email: owner, password } });

      const renewed = await login(owner, replacement);
      await request('/auth/logout', 204, { ...renewed, method: 'POST' });
      await request('/auth/me', 401, renewed);
      await request('/auth/refresh', 401, { ...renewed, method: 'POST' });
      await request('/auth/logout-all', 204, { ...outsiderSession, method: 'POST' });
      await request('/auth/me', 401, outsiderSession);

      const ownerRecord = await db.user.findUniqueOrThrow({ where: { email: owner } });
      const seenRecovery = new Set();
      await codeFor(owner, 'Reset your CropCircle password', seenRecovery);
      await recover(owner);
      const expired = await codeFor(owner, 'Reset your CropCircle password', seenRecovery);
      await db.authToken.updateMany({
        where: { userId: ownerRecord.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await request('/auth/password-reset', 400, { body: { token: expired, password } });

      for (let attempt = 0; attempt < 3; attempt++) await recover(missing);
      await request('/auth/password-recovery', 429, { body: { email: missing } });
    });
  },
);
