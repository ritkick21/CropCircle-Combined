import { PrismaClient, type PlatformRole } from '@prisma/client';

const [role, email] = process.argv.slice(2);
const roles: readonly PlatformRole[] = ['FARMER', 'RESEARCHER', 'PROFESSIONAL'];

async function main() {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  ) {
    throw new Error('Set DATABASE_URL to your local demo database.');
  }
  if (!email || !roles.includes(role as PlatformRole)) {
    throw new Error('Usage: demo-role.ts <FARMER|RESEARCHER|PROFESSIONAL> <verified email>');
  }

  const db = new PrismaClient();
  try {
    const result = await db.user.updateMany({
      where: {
        email: email.trim().toLowerCase(),
        status: 'ACTIVE',
        emailVerifiedAt: { not: null },
        deletedAt: null,
        NOT: { roles: { has: role as PlatformRole } },
      },
      data: { roles: { push: role as PlatformRole } },
    });
    if (!result.count) {
      const user = await db.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { roles: true },
      });
      if (!user?.roles.includes(role as PlatformRole))
        throw new Error('Verify the demo account before granting it a role.');
      console.log('The account already has this role.');
      return;
    }
    console.log('Demo role granted. Sign out and sign back in to refresh the session.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unable to grant the demo role.');
  process.exitCode = 1;
});
