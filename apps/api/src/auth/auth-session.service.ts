import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { day, hashToken, lockUser, randomToken } from './credentials';

export const accessTokenSeconds = 10 * 60;
export const sessionLifetime = 30 * day;
export const jwtIssuer = 'cropcircle-api';
export const jwtAudience = 'cropcircle-rest';

const principalSelect = {
  id: true,
  email: true,
  displayName: true,
  emailVerifiedAt: true,
  roles: true,
} satisfies Prisma.UserSelect;

export type Principal = Prisma.UserGetPayload<{ select: typeof principalSelect }>;
export type Identity = { user: Principal; sessionId: string };
export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

export const activeAccount = {
  status: AccountStatus.ACTIVE,
  emailVerifiedAt: { not: null },
  deletedAt: null,
} satisfies Prisma.UserWhereInput;

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async create(userId: string, expectedHash: string): Promise<SessionTokens> {
    const refreshToken = randomToken();
    const session = await this.db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const account = await tx.user.findFirst({
        where: { id: userId, ...activeAccount, passwordHash: expectedHash },
        select: { id: true },
      });
      if (!account) throw new UnauthorizedException('Invalid email or password');

      await tx.authSession.deleteMany({
        where: { userId, expiresAt: { lte: new Date() } },
      });
      return tx.authSession.create({
        data: {
          userId,
          refreshHash: hashToken(refreshToken),
          expiresAt: new Date(Date.now() + sessionLifetime),
        },
        select: { id: true, expiresAt: true },
      });
    });
    return this.tokens(userId, session, refreshToken);
  }

  async refresh(currentToken: string): Promise<SessionTokens> {
    const refreshHash = hashToken(currentToken);
    const activeSession = {
      refreshHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: activeAccount,
    } satisfies Prisma.AuthSessionWhereInput;
    const session = await this.db.authSession.findFirst({
      where: activeSession,
      select: { id: true, userId: true, expiresAt: true },
    });
    if (!session) throw new UnauthorizedException('Invalid session');

    const refreshToken = randomToken();
    const rotation = await this.db.authSession.updateMany({
      where: { id: session.id, ...activeSession },
      data: { refreshHash: hashToken(refreshToken) },
    });
    if (rotation.count !== 1) throw new UnauthorizedException('Invalid session');
    return this.tokens(session.userId, session, refreshToken);
  }

  async authenticate(accessToken: string): Promise<Identity & { accessExpiresAt: number }> {
    let claims: { sub?: unknown; sid?: unknown; exp?: unknown };
    try {
      claims = await this.jwt.verifyAsync(accessToken, {
        algorithms: ['HS256'],
        issuer: jwtIssuer,
        audience: jwtAudience,
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
    if (
      typeof claims?.sub !== 'string' ||
      !isUUID(claims.sub) ||
      typeof claims.sid !== 'string' ||
      !isUUID(claims.sid) ||
      typeof claims.exp !== 'number'
    ) {
      throw new UnauthorizedException('Invalid access token');
    }
    const session = await this.db.authSession.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: activeAccount,
      },
      select: { id: true, user: { select: principalSelect } },
    });
    if (!session) throw new UnauthorizedException('Invalid session');
    return { user: session.user, sessionId: session.id, accessExpiresAt: claims.exp * 1000 };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.db.authSession.updateMany({
      where: { refreshHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  private async tokens(
    userId: string,
    session: { id: string; expiresAt: Date },
    refreshToken: string,
  ): Promise<SessionTokens> {
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: session.id });
    return { accessToken, refreshToken, expiresAt: session.expiresAt };
  }
}
